"""Numerical/export tests; optional MLX math tests use its CPU reference device."""
from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path
import signal
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

import numpy as np

MODULE = Path(__file__).resolve().parents[1] / "python/mlx_ppo.py"
loader = importlib.util.spec_from_file_location("dsh_mlx_ppo", MODULE)
learner = importlib.util.module_from_spec(loader)
loader.loader.exec_module(learner)


def frozen_vec_normalizer(mean, variance):
    """Use SB3's real normalization methods without creating simulator workers."""
    from stable_baselines3.common.vec_env import VecNormalize
    from stable_baselines3.common.running_mean_std import RunningMeanStd
    env = VecNormalize.__new__(VecNormalize)
    env.norm_obs = True
    env.clip_obs = 100.0
    env.epsilon = 1e-8
    env.obs_rms = RunningMeanStd(shape=(61,))
    env.obs_rms.mean = np.asarray(mean, np.float64).copy()
    env.obs_rms.var = np.asarray(variance, np.float64).copy()
    return env


class RecipeTests(unittest.TestCase):
    def test_import_does_not_initialize_optional_runtime(self):
        import subprocess
        code = ("import runpy,sys; runpy.run_path(sys.argv[1]); "
                "assert 'mlx.core' not in sys.modules; assert 'torch' not in sys.modules; "
                "assert 'rlx' not in sys.modules")
        subprocess.run([sys.executable, "-B", "-c", code, str(MODULE)], check=True)

    def test_resolves_tiny_horizon_and_divisible_minibatches(self):
        config = learner.recipe({"steps": 5, "envs": 2})
        self.assertEqual(config["horizon"], 3)
        self.assertEqual(config["minibatchSize"], 6)
        self.assertEqual(config, learner.recipe({"steps": 5, "envs": 2}, config))
        self.assertEqual(json.loads(json.dumps(config)), config)
        config = learner.recipe({"steps": 10000, "envs": 3}, {"minibatchSize": 100})
        self.assertEqual(768 % config["minibatchSize"], 0)
        self.assertEqual(learner.recipe()["hiddenSizes"], [512, 256, 128])
        self.assertEqual(config["normalizationArithmetic"], "float64-then-float32")

    def test_rejects_unsupported_or_nonfinite_recipes(self):
        for override in ({"horizon": 0}, {"horizon": True}, {"gamma": 1.1},
                         {"learningRateStart": float("nan")}, {"vectorBackend": "thread"},
                         {"rewardNormalization": True}, {"unknown": 1}, {"hiddenSizes": []},
                         {"clipRange": 0}, {"normalizationEpsilon": 0},
                         {"normalizationArithmetic": "float32"}):
            with self.subTest(override=override), self.assertRaises(ValueError):
                learner.recipe(overrides=override)

    def test_explicit_backend_is_required_before_environment_creation(self):
        with self.assertRaisesRegex(ValueError, "explicitly selected"):
            learner.train(Path("unused"), {"backend": "cpu"}, None, 10)


class LifecycleTests(unittest.TestCase):
    def test_optional_runtime_failure_cleans_workers_and_restores_signals(self):
        import builtins
        original_import = builtins.__import__
        raw = Mock(processes=[], remotes=[])
        make_vec = Mock(return_value=raw)
        package = types.ModuleType("microduck_local")
        vec_module = types.ModuleType("microduck_local.vec_env")
        vec_module.make_vec_env = make_vec
        vec_module.as_sb3_vec_env = Mock()
        def importing(name, *args, **kwargs):
            if name == "mlx.core":
                make_vec.assert_called_once()
                self.assertEqual(make_vec.call_args.kwargs, {"backend": "fork"})
                raise ImportError("optional MLX unavailable")
            return original_import(name, *args, **kwargs)
        handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
        spec = {"backend": "mlx", "steps": 1, "envs": 1, "seed": 0, "weights": {}, "behaviorId": "stand"}
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(sys.modules, {"microduck_local": package, "microduck_local.vec_env": vec_module}):
                # Model the fresh training process, independent of other tests' imports.
                sys.modules.pop("torch", None)
                sys.modules.pop("mlx.core", None)
                with patch("builtins.__import__", side_effect=importing):
                    with self.assertRaisesRegex(ImportError, "optional MLX"):
                        learner.train(Path(directory), spec, Mock(return_value=lambda: None), 1)
            self.assertFalse((Path(directory) / "policy.onnx").exists())
        for sig, handler in handlers.items():
            self.assertEqual(signal.getsignal(sig), handler)
        raw.close.assert_not_called()

    def test_interrupted_cleanup_does_not_wait_for_dead_worker_semaphore(self):
        process = Mock()
        process.is_alive.side_effect = [True, True]
        remote = Mock()
        raw = Mock(processes=[process], remotes=[remote])
        learner._close_workers(raw, True)
        raw.close.assert_not_called()
        process.terminate.assert_called_once()
        process.kill.assert_called_once()
        self.assertEqual(process.join.call_count, 2)
        remote.close.assert_called_once()

    def test_successful_cleanup_joins_through_vector_environment(self):
        raw = Mock()
        learner._close_workers(raw, False)
        raw.close.assert_called_once()


class AdvantageTests(unittest.TestCase):
    def test_terminal_flag_belongs_to_its_transition(self):
        # A terminal at t=0 must not acquire the reward of the auto-reset episode.
        adv, returns = learner.advantages([[2.0], [100.0]], [[0.5], [1.0]],
                                         [[True], [False]], [3.0], 0.9, 1.0)
        np.testing.assert_allclose(adv[:, 0], [1.5, 101.7], rtol=1e-6)
        np.testing.assert_allclose(returns[:, 0], [2.0, 102.7], rtol=1e-6)

    def test_timeout_bootstraps_terminal_not_reset_observation(self):
        seen = []
        def bootstrap(obs):
            seen.append(obs)
            return 0.9 * float(obs[0])
        adjusted = learner.timeout_rewards([2, 3, 4], [True, True, False], [
            {"TimeLimit.truncated": True, "terminal_observation": [10]},
            {"TimeLimit.truncated": False, "terminal_observation": [900]},
            {}], bootstrap)
        np.testing.assert_array_equal(adjusted, [11, 3, 4])
        self.assertEqual(seen, [[10]])
        _, returns = learner.advantages([adjusted], [[1, 1, 1]], [[True, True, False]],
                                        [1000, 1000, 5], 0.9, 0.95)
        np.testing.assert_allclose(returns, [[11, 3, 8.5]])

    def test_missing_timeout_terminal_fails(self):
        with self.assertRaisesRegex(ValueError, "terminal_observation"):
            learner.timeout_rewards([1], [True], [{"TimeLimit.truncated": True}], lambda x: 0)

    def test_nonterminal_horizon_and_lambda(self):
        adv, _ = learner.advantages([[1], [2]], [[0.2], [0.4]], [[False], [False]], [0.8], 0.9, 0.5)
        last = 2 + 0.9 * 0.8 - 0.4
        np.testing.assert_allclose(adv[:, 0], [1 + 0.9 * 0.4 - 0.2 + 0.9 * 0.5 * last, last], rtol=1e-6)

    def test_rejects_mismatched_trajectory_arrays(self):
        with self.assertRaises(ValueError):
            learner.advantages([1], [2], [False], [3], 0.9, 0.95)


class NormalizationTests(unittest.TestCase):
    def test_freezes_statistics_and_clips_observation(self):
        mean = np.array([1.0, 4.0])
        variance = np.array([4.0, 0.0])
        got = learner.normalize_observations([[5, 100]], mean, variance, 100, 1e-8)
        np.testing.assert_allclose(got, [[2, 100]])
        np.testing.assert_array_equal(mean, [1, 4])
        np.testing.assert_array_equal(variance, [4, 0])
        self.assertEqual(got.dtype, np.float32)

    @unittest.skipUnless(importlib.util.find_spec("stable_baselines3"), "SB3 unavailable")
    def test_matches_actual_vecnormalize_without_rounding_statistics(self):
        mean = np.full(61, 1 - 1e-8, np.float64)
        variance = np.full(61, 2e-8, np.float64)
        env = frozen_vec_normalizer(mean, variance)
        observations = np.stack([np.ones(61, np.float32), np.full(61, 100, np.float32)])
        expected = env.normalize_obs(observations)
        self.assertAlmostEqual(float(expected[0, 0]), 5.77350256e-5, places=11)
        actual = learner.normalize_observations(observations, mean, variance, 100, 1e-8)
        np.testing.assert_array_equal(actual, expected)
        np.testing.assert_array_equal(env.obs_rms.mean, mean)
        np.testing.assert_array_equal(env.obs_rms.var, variance)

    def test_nonfinite_values_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "non-finite"):
            learner._finite([np.nan], "actions")


@unittest.skipUnless(importlib.util.find_spec("onnx") and importlib.util.find_spec("onnxruntime"), "ONNX dependencies unavailable")
class ExportTests(unittest.TestCase):
    def setUp(self):
        self.config = learner.recipe()
        self.mean = np.linspace(-1, 1, 61)
        self.variance = np.linspace(0, 2, 61)
        rng = np.random.default_rng(23)
        self.layers = [(rng.normal(0, 0.1, (9, 61)).astype(np.float32), np.zeros(9, np.float32)),
                       (rng.normal(0, 0.1, (14, 9)).astype(np.float32), np.full(14, 8, np.float32))]

    def reference(self, obs):
        x = learner.normalize_observations(obs, self.mean, self.variance, 100, 1e-8)
        x = x @ self.layers[0][0].T + self.layers[0][1]
        x = np.where(x > 0, x, np.expm1(np.minimum(x, 0)))
        return x @ self.layers[1][0].T + self.layers[1][1]

    def test_export_preserves_unbounded_deterministic_mean(self):
        import onnxruntime as ort
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "policy.onnx"
            learner.export_actor(path, self.layers, self.mean, self.variance, self.config, self.reference)
            session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
            actual = session.run(None, {"obs": self.mean.astype(np.float32)[None]})[0]
            np.testing.assert_allclose(actual, 8)
            self.assertEqual(session.get_inputs()[0].shape, [1, 61])
            self.assertEqual(session.get_outputs()[0].shape, [1, 14])

    @unittest.skipUnless(importlib.util.find_spec("stable_baselines3"), "SB3 unavailable")
    def test_low_variance_identity_actor_preserves_training_normalization(self):
        import onnxruntime as ort
        mean = np.full(61, 1 - 1e-8, np.float64)
        variance = np.full(61, 2e-8, np.float64)
        env = frozen_vec_normalizer(mean, variance)
        layers = [(np.eye(14, 61, dtype=np.float32), np.zeros(14, np.float32))]
        observation = np.ones((1, 61), np.float32)
        expected = env.normalize_obs(observation)[:, :14]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "identity.onnx"
            learner.export_actor(path, layers, mean, variance, self.config,
                                 lambda obs: env.normalize_obs(obs)[:, :14], observation)
            session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
            actual = session.run(None, {"obs": observation})[0]
            np.testing.assert_allclose(actual, expected, rtol=1e-4, atol=1e-5)
            np.testing.assert_array_equal(actual, expected)

    def test_failed_parity_does_not_replace_existing_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "live.onnx"
            path.write_bytes(b"existing")
            with self.assertRaises(AssertionError):
                learner.export_actor(path, self.layers, self.mean, self.variance, self.config, lambda obs: np.zeros((1, 14)))
            self.assertEqual(path.read_bytes(), b"existing")
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_invalid_weights_or_statistics_do_not_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "policy.onnx"
            for variance, layers in ((np.full(61, -1), self.layers), (self.variance, [(np.zeros((14, 60)), np.zeros(14))]),
                                      (self.variance, [(np.full((14, 61), np.nan), np.zeros(14))])):
                with self.subTest(), self.assertRaises(ValueError):
                    learner.export_actor(path, layers, self.mean, variance, self.config, self.reference)
                self.assertFalse(path.exists())


@unittest.skipUnless(importlib.util.find_spec("mlx"), "optional MLX not installed")
class MlxNumericalTests(unittest.TestCase):
    def setUp(self):
        import mlx.core as mx
        import mlx.nn as nn
        self.mx, self.nn = mx, nn
        self.previous_device = mx.default_device()
        mx.set_default_device(mx.cpu)
        mx.random.seed(12)
        self.config = learner.recipe(overrides={"hiddenSizes": [8, 4]})
        self.Model, self.logp, self.loss = learner.mlx_components(mx, nn, self.config)

    def tearDown(self):
        self.mx.set_default_device(self.previous_device)

    def test_gaussian_density_matches_numpy_and_raw_samples(self):
        mx = self.mx
        mean = mx.full((2, 14), 8.0)
        log_std = mx.full((14,), -0.5)
        action = mean + mx.exp(log_std) * mx.random.normal(mean.shape)
        actual = self.logp(action, mean, log_std)
        mx.eval(action, actual)
        z = (np.asarray(action) - 8) / math.exp(-0.5)
        expected = np.sum(-0.5 * z * z + 0.5 - 0.5 * math.log(2 * math.pi), axis=-1)
        np.testing.assert_allclose(np.asarray(actual), expected, atol=2e-5)
        self.assertTrue(np.all(np.asarray(action) > 4))

    @unittest.skipUnless(importlib.util.find_spec("onnx") and importlib.util.find_spec("onnxruntime") and importlib.util.find_spec("stable_baselines3"), "ONNX/SB3 dependencies unavailable")
    def test_metal_actor_export_matches_cpu_onnx(self):
        mx = self.mx
        if not mx.metal.is_available():
            self.skipTest("Metal unavailable")
        mx.set_default_device(mx.gpu)
        model = self.Model()
        mx.eval(model.parameters())
        mean = np.full(61, 1 - 1e-8, np.float64)
        variance = np.full(61, 2e-8, np.float64)
        env = frozen_vec_normalizer(mean, variance)
        layers = [(np.asarray(layer.weight), np.asarray(layer.bias)) for layer in model.actor]
        def reference(obs):
            normalized = env.normalize_obs(obs)
            action = model.actor_mean(mx.array(normalized))
            mx.eval(action)
            return np.asarray(action)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "policy.onnx"
            learner.export_actor(path, layers, mean, variance, self.config, reference,
                                 np.ones((1, 61), np.float32))
            self.assertTrue(path.is_file())

    def test_real_gradient_updates_actor_and_critic(self):
        import mlx.optimizers as optim
        mx, nn = self.mx, self.nn
        model = self.Model()
        obs = mx.random.normal((4, 61))
        mean, values = model(obs)
        actions = mean + 0.2
        old_logp = self.logp(actions, mean, model.log_std)
        mx.eval(mean, values, actions, old_logp)
        before = np.asarray(model.actor[-1].weight).copy()
        objective, grads = nn.value_and_grad(model, self.loss)(model, obs, actions, old_logp,
                                                              mx.ones((4,)), mx.array([1., 2., 4., 8.]), 0.01)
        grads, norm = optim.clip_grad_norm(grads, 1.0)
        optimizer = optim.Adam(1e-3, eps=1e-5)
        optimizer.update(model, grads)
        mx.eval(model.parameters(), objective, norm)
        self.assertTrue(np.isfinite(np.asarray(objective)))
        self.assertTrue(float(norm.item()) > 0)
        self.assertFalse(np.array_equal(before, np.asarray(model.actor[-1].weight)))


if __name__ == "__main__":
    unittest.main()
