"""Keyless validation tests without MuJoCo or external repository dependencies."""
import importlib.util
import math
import copy
import hashlib
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("robot_bridge", Path(__file__).parents[1] / "python/bridge.py")
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)

LIMITS = {"maxClipSeconds": 10, "maxClipKeys": 8}


def clip():
    return {"version": 1, "name": "Head sway", "duration": 1, "loop": True,
            "keys": [{"t": 0, "joints": [0.0] * 14, "rootPitch": 0},
                     {"t": 1, "joints": [0.0] * 14, "rootPitch": 0}]}


class ClipTests(unittest.TestCase):
    def test_accepts_complete_loop(self):
        bridge.validate_clip(clip(), LIMITS)

    def test_clip_names_preserve_unicode_display_text_and_reject_invalid_scalars(self):
        for name in (" 我的鸭鸭 / ディスコ 🦆💃 ", "🦆" * 64):
            value = {**clip(), "name": name}
            bridge.validate_clip(value, LIMITS)
            self.assertEqual(value["name"], name)
        for name in ("", "   ", "\u0000", "\u0085", "\ud800", "🦆" * 65):
            with self.subTest(name=repr(name)), self.assertRaisesRegex(ValueError, "display name"):
                bridge.validate_clip({**clip(), "name": name}, LIMITS)

    def test_rejects_preview_heading_instead_of_training_without_it(self):
        value = clip()
        value["version"] = 2
        for key in value["keys"]:
            key["rootYaw"] = 0.0
        for version in (2, 3):
            value["version"] = version
            with self.assertRaisesRegex(ValueError, "version"):
                bridge.validate_clip(value, LIMITS)
        value["version"] = 1
        with self.assertRaisesRegex(ValueError, "clip keys require"):
            bridge.validate_clip(value, LIMITS)

    def test_rejects_nonfinite_joint(self):
        value = clip()
        value["keys"][0]["joints"][2] = math.nan
        with self.assertRaisesRegex(ValueError, "finite"):
            bridge.validate_clip(value, LIMITS)

    def test_rejects_missing_endpoint(self):
        value = clip()
        value["keys"][-1]["t"] = 0.5
        with self.assertRaisesRegex(ValueError, "duration"):
            bridge.validate_clip(value, LIMITS)

    def test_rejects_discontinuous_loop(self):
        value = clip()
        value["keys"][-1]["joints"][1] = 0.1
        with self.assertRaisesRegex(ValueError, "endpoints"):
            bridge.validate_clip(value, LIMITS)

    def test_rejects_executable_extra_fields(self):
        value = clip()
        value["reward_python"] = "raise RuntimeError('must never execute')"
        with self.assertRaisesRegex(ValueError, "exactly"):
            bridge.validate_clip(value, LIMITS)

    def test_rejects_duplicate_key_times(self):
        value = clip()
        value["keys"][1]["t"] = 0
        with self.assertRaisesRegex(ValueError, "increasing"):
            bridge.validate_clip(value, LIMITS)

    def test_digest_changes_with_reference(self):
        first = clip()
        second = clip()
        second["keys"][0]["rootPitch"] = 0.1
        self.assertNotEqual(bridge.digest(first), bridge.digest(second))

    def test_run_path_rejects_traversal_and_symlink_escape(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            package = source / "microduck_local/src/microduck_local"
            package.mkdir(parents=True)
            (package / "contract.py").write_text("# path validation fixture\n")
            provider = bridge.Bridge(source, root / "storage", LIMITS)
            with self.assertRaisesRegex(ValueError, "identity"):
                provider.path("../../outside")
            runs = provider.root / "runs"
            runs.mkdir(parents=True)
            identifier = "run-00000000-0000-0000-0000-000000000000"
            (runs / identifier).symlink_to(source, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "escapes"):
                provider.path(identifier)


class BackendTests(unittest.TestCase):
    def spec(self):
        return {"name": "fixture", "behaviorId": "stand", "steps": 8, "envs": 1, "seed": 0,
                "actuator": "bam", "weights": {}, "clip": None}

    def limits(self):
        return {"maxTrainingSteps": 100, "maxEnvs": 2, "maxRewardWeight": 10}

    def test_resolves_cpu_without_mutating_admission_and_rejects_unknown_backend(self):
        modules = {"microduck_local.behaviors": SimpleNamespace(BEHAVIORS={"stand": SimpleNamespace(clip_name=None, terms=[])}, CATALOG={})}
        with patch.dict(sys.modules, modules):
            spec = self.spec()
            self.assertEqual(bridge.validate_spec(spec, self.limits())["backend"], "cpu")
            self.assertNotIn("backend", spec)
            numeric = bridge.validate_spec({**spec, "steps": 8.0, "envs": 1.0, "seed": 0.0}, self.limits())
            self.assertTrue(all(type(numeric[key]) is int for key in ("steps", "envs", "seed")))
            self.assertEqual(bridge.validate_spec({**spec, "backend": "mlx"}, self.limits())["backend"], "mlx")
            with self.assertRaisesRegex(ValueError, "backend"):
                bridge.validate_spec({**spec, "backend": "auto"}, self.limits())

    def test_failed_mlx_admission_does_not_create_run_or_fallback(self):
        with tempfile.TemporaryDirectory() as temporary:
            provider = object.__new__(bridge.Bridge)
            provider.root = Path(temporary)
            provider.limits = self.limits()
            spec = {**self.spec(), "backend": "mlx"}
            with (patch.object(bridge, "validate_spec", return_value=spec),
                  patch.object(bridge, "trainer_provenance", side_effect=ValueError("Metal unavailable")) as probe):
                with self.assertRaisesRegex(ValueError, "Metal unavailable"):
                    provider.prepare_train("run-00000000-0000-0000-0000-000000000000", spec)
                probe.assert_called_once_with(spec)
            self.assertFalse((provider.root / "runs").exists())

    def test_metal_probe_uses_a_child_and_reports_native_failure(self):
        with (patch.object(bridge.platform, "system", return_value="Darwin"),
              patch.object(bridge.platform, "machine", return_value="arm64"),
              patch.object(bridge.sys, "version_info", (3, 12)),
              patch.object(bridge.subprocess, "run", return_value=SimpleNamespace(returncode=1, stderr="native Metal failed")) as launch):
            with self.assertRaisesRegex(ValueError, "native Metal failed"):
                bridge.mlx_probe()
            self.assertEqual(launch.call_args.args[0][:2], [sys.executable, "-B"])
            self.assertEqual(launch.call_args.kwargs["timeout"], 30)


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.provider = object.__new__(bridge.Bridge)
        self.provider.root = self.root
        self.provider.source = self.root / "source"
        self.provider.limits = {"maxSimulationSteps": 100, "maxEvaluationEpisodes": 2}
        self.run_id = "run-00000000-0000-0000-0000-000000000000"
        self.policy_id = "run:" + self.run_id
        self.path = self.provider.path(self.run_id)
        self.path.mkdir(parents=True)
        self.data = b"exported ONNX fixture"
        self.checksum = hashlib.sha256(self.data).hexdigest()
        self.policy_path = self.path / "policy.onnx"
        self.policy_path.write_bytes(self.data)
        bam = {"source": "installed BAM", "parameters": {"kt": 0.3}}
        self.bam = {**bam, "sha256": bridge.digest(bam)}
        self.run = {"formatVersion": 3, "id": self.run_id, "state": "completed",
                    "policyId": self.policy_id, "policySha256": self.checksum,
                    "spec": {"name": "fixture", "clip": None}, "observationProfile": bridge.STANDARD,
                    "provenance": {"bam": self.bam, "bridgeSha256": bridge.bridge_hash(),
                                   "dependencyVersions": {}}, "sourceFingerprint": "source"}
        self.select_backend("cpu")
        for mock in (patch.object(bridge, "runtime_versions", return_value={}),
                     patch.object(bridge, "bam_provenance", return_value=self.bam),
                     patch.object(self.provider, "fingerprint", return_value="source")):
            mock.start()
            self.addCleanup(mock.stop)

    def save_run(self):
        bridge.write_json(self.path / "manifest.json", self.run)

    def select_backend(self, backend="mlx"):
        self.run["formatVersion"] = 3
        self.run["spec"]["backend"] = backend
        self.run["recipeHash"] = bridge.digest(self.run["spec"])
        helpers = {}
        if backend == "mlx":
            helpers["mlx_ppo.py"] = bridge.file_hash(Path(bridge.__file__).with_name("mlx_ppo.py"))
        value = {"backend": backend, "learnerDevice": "metal" if backend == "mlx" else "cpu", "physicsDevice": "cpu",
                 "helperSha256": helpers, "recipe": {"version": "fixture"}, "dependencyVersions": {"mlx": "fixture"}}
        self.run["provenance"]["trainer"] = {**value, "sha256": bridge.digest(value)}
        self.run["provenance"]["environment"] = {"updateDevice": value["learnerDevice"]}
        self.save_run()

    def test_portable_mlx_onnx_load_does_not_require_mlx_dependencies(self):
        self.select_backend()
        with patch.object(bridge, "runtime_versions", return_value={}), patch.object(bridge, "trainer_provenance", side_effect=AssertionError("must not initialize GPU")):
            self.assertEqual(self.provider.load_policy(self.policy_id)[3], self.checksum)

    def test_rejects_tampered_learner_recipe_and_helper(self):
        self.select_backend()
        self.run["provenance"]["trainer"]["recipe"]["version"] = "tampered"
        self.save_run()
        with self.assertRaisesRegex(ValueError, "trainer provenance hash"):
            self.provider.load_policy(self.policy_id)
        self.select_backend()
        self.run["provenance"]["trainer"]["helperSha256"]["mlx_ppo.py"] = "0" * 64
        trainer = self.run["provenance"]["trainer"]
        trainer["sha256"] = bridge.digest({k: v for k, v in trainer.items() if k != "sha256"})
        self.save_run()
        with patch.object(bridge, "runtime_versions", return_value={}), self.assertRaisesRegex(ValueError, "learner/exporter"):
            self.provider.load_policy(self.policy_id)

    def test_state_sidecar_overlays_terminal_state_without_rewriting_frozen_manifest(self):
        self.select_backend("cpu")
        frozen = (self.path / "manifest.json").read_bytes()
        (self.path / "state.json").write_text(json.dumps(
            {"state": "interrupted", "error": "host settled", "finishedAt": "2026-09-05T00:00:00Z"}))
        run = self.provider.run(self.run_id)
        self.assertEqual((run["state"], run["error"], run["finishedAt"]),
                         ("interrupted", "host settled", "2026-09-05T00:00:00Z"))
        self.assertEqual((self.path / "manifest.json").read_bytes(), frozen)

    def test_bridge_bundle_hash_detects_studio_only_code_drift(self):
        original_hash = bridge.file_hash
        before = bridge.bridge_hash()
        with patch.object(bridge, "file_hash", side_effect=lambda path: "0" * 64 if path.name == "studio.py" else original_hash(path)):
            self.assertNotEqual(bridge.bridge_hash(), before)
            with self.assertRaisesRegex(ValueError, "bridge/studio bundle"):
                self.provider.load_policy(self.policy_id)
        self.assertEqual(bridge.bridge_hash(), before)

    def test_learner_helpers_reject_nonlearner_code_on_both_backends(self):
        for backend in ("cpu", "mlx"):
            self.select_backend(backend)
            trainer = self.run["provenance"]["trainer"]
            self.assertEqual(set(trainer["helperSha256"]), {"mlx_ppo.py"} if backend == "mlx" else set())
            trainer["helperSha256"]["studio.py"] = "0" * 64
            trainer["sha256"] = bridge.digest({k: v for k, v in trainer.items() if k != "sha256"})
            self.save_run()
            with self.assertRaisesRegex(ValueError, "helper provenance"):
                self.provider.run(self.run_id)

    def test_unsupported_version_does_not_interpret_metadata_or_block_supported_listing(self):
        old_id = "run-22222222-2222-2222-2222-222222222222"
        old_path = self.provider.path(old_id)
        old_path.mkdir()
        bridge.write_json(old_path / "manifest.json", {"formatVersion": 2, "opaque_old_data": True})
        old_bytes = (old_path / "manifest.json").read_bytes()
        listing = self.provider.list_runs()
        self.assertEqual([run["id"] for run in listing["runs"]], [self.run_id])
        self.assertEqual(listing["incompatibleRuns"], [{"id": old_id, "formatVersion": 2,
            "reason": "unsupported Robot Lab run format; only version 3 is supported"}])
        self.assertEqual([policy["id"] for policy in self.provider.policies()], [self.policy_id])
        for operation in (lambda: self.provider.run(old_id), lambda: self.provider.train(old_id),
                          lambda: self.provider.load_policy("run:" + old_id)):
            with self.assertRaisesRegex(ValueError, "unsupported Robot Lab run format"):
                operation()
        self.assertEqual((old_path / "manifest.json").read_bytes(), old_bytes)

    def evaluation_spec(self, policy_id=None):
        return {"policyId": policy_id or self.policy_id, "episodes": 1, "stepsPerEpisode": 10,
                "seed": 123, "maxTerminations": 0, "minMeanUprightFraction": 0.9}

    def test_rejects_replaced_policy_at_every_loader_consumer(self):
        self.policy_path.write_bytes(b"replacement")
        for operation in (lambda: self.provider.policy(self.policy_id),
                          lambda: self.provider.simulate({"policyId": self.policy_id, "steps": 10, "seed": 1, "command": [0, 0, 0]}),
                          lambda: self.provider.evaluate(self.evaluation_spec())):
            with self.subTest(operation=operation), self.assertRaisesRegex(ValueError, "policy hash"):
                operation()
        self.assertFalse((self.root / "evaluations").exists())

    def test_rejects_missing_hash_incomplete_run_and_old_format(self):
        for changes in ({"policySha256": None}, {"state": "running"}, {"formatVersion": 1}):
            original = copy.deepcopy(self.run)
            self.run.update(changes)
            self.save_run()
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.provider.load_policy(self.policy_id)
            self.run = original

    def test_onnx_session_receives_the_verified_buffer_not_reopened_path(self):
        loaded = self.provider.load_policy(self.policy_id)
        self.policy_path.write_bytes(b"replaced after verification")
        class SessionReached(Exception):
            pass
        def inference(data, providers):
            self.assertIs(data, loaded[2])
            self.assertEqual(data, self.data)
            self.assertEqual(hashlib.sha256(data).hexdigest(), loaded[3])
            self.assertEqual(providers, ["CPUExecutionProvider"])
            raise SessionReached()
        modules = {"numpy": SimpleNamespace(), "onnxruntime": SimpleNamespace(InferenceSession=inference),
                   "microduck_local": SimpleNamespace(contract=SimpleNamespace())}
        with patch.dict(sys.modules, modules), self.assertRaises(SessionReached):
            self.provider.rollout(loaded, self.provider.physics(loaded), 1, 0, [0, 0, 0], False)

    def test_rollout_horizon_overrides_training_duration_for_owned_and_shipped_policies(self):
        class EnvironmentReached(Exception):
            pass
        descriptor = SimpleNamespace(shape=[1, 61], type="tensor(float)")
        session = SimpleNamespace(get_inputs=lambda: [descriptor],
                                  get_outputs=lambda: [SimpleNamespace(shape=[1, 14])])
        constructed = []
        def environment(*args, **kwargs):
            constructed.append(kwargs)
            raise EnvironmentReached()
        bam = SimpleNamespace(load_bam_params=lambda: ({}, "fixture"))
        modules = {"numpy": SimpleNamespace(),
                   "onnxruntime": SimpleNamespace(InferenceSession=lambda *args, **kwargs: session),
                   "microduck_local": SimpleNamespace(contract=SimpleNamespace(CTRL_DT=0.02), bam_actuator=bam),
                   "microduck_local.behaviors": SimpleNamespace(BehaviorEnv=environment),
                   "microduck_local.walk_env": SimpleNamespace(MicroduckWalkEnv=environment)}
        self.run["spec"].update(behaviorId="imitate", weights={})
        with patch.dict(sys.modules, modules):
            for run in (self.run, None):
                for steps in (200, 1000, 1500):
                    with self.subTest(owned=run is not None, steps=steps), self.assertRaises(EnvironmentReached):
                        self.provider.rollout((self.policy_path, run, self.data, self.checksum),
                                              {"bam": self.bam}, steps, 7, [0, 0, 0], True)
                    self.assertEqual(constructed[-1]["max_episode_s"], steps / 50)
                    self.assertNotIn("terminate_on_fall", constructed[-1])
                    self.assertTrue(constructed[-1]["action_delay"])
                    if run is not None:
                        self.assertFalse(constructed[-1]["spotter"])
                        self.assertTrue(constructed[-1]["standing_spawns"])

    def test_rollout_executes_requested_steps_and_keeps_fall_termination(self):
        class Observation(list):
            def __getitem__(self, index):
                return self if index is None else super().__getitem__(index)
        class Environment:
            def __init__(env, *args, **kwargs):
                env.max_steps = round(kwargs.get("max_episode_s", 4) / 0.02)
                env.step_count = 0
                env.closed = False
                env.actuator_model = "bam"
                env.obs_noise = env.domain_rand = env.random_yaw = False
                env.action_delay = True
                env.bam = SimpleNamespace(p=self.bam["parameters"])
                env.model = SimpleNamespace()
                env.data = SimpleNamespace(xpos=[], xquat=[])
                env.observation = Observation([0, 0, 0, 0, 0, -1])
                environments.append(env)
            def reset(env, seed):
                return env.observation, {}
            def step(env, action):
                env.step_count += 1
                return env.observation, 1, env.step_count == fall_step, env.step_count >= env.max_steps, {}
            def close(env):
                env.closed = True
        inference_calls = []
        def infer(*args):
            inference_calls.append(args)
            return [[[0.0] * 14]]
        session = SimpleNamespace(get_inputs=lambda: [SimpleNamespace(shape=[1, 61], type="tensor(float)", name="obs")],
                                  get_outputs=lambda: [SimpleNamespace(shape=[1, 14])], run=infer)
        numpy = SimpleNamespace(asarray=lambda value, **kwargs: value, float32="float32",
                                isfinite=lambda value: SimpleNamespace(all=lambda: True),
                                mean=lambda values: sum(values) / len(values),
                                column_stack=lambda values: SimpleNamespace(tolist=lambda: []))
        state = {"jointPosition": [0.0] * 14, "jointVelocity": [0.0] * 14,
                 "controllerTarget": [0.0] * 14, "actuatorTorque": [0.0] * 14,
                 "rootBody": "trunk_base", "rootLinearVelocityWorld": [0.0] * 3,
                 "rootSpeed": 0.0, "rootTilt": 0.0}
        modules = {"numpy": numpy,
                   "studio": SimpleNamespace(model_layout=lambda model: {}, telemetry=lambda model, data, layout: state),
                   "onnxruntime": SimpleNamespace(InferenceSession=lambda *args, **kwargs: session),
                   "microduck_local": SimpleNamespace(contract=SimpleNamespace(CTRL_DT=0.02),
                       bam_actuator=SimpleNamespace(load_bam_params=lambda: ({}, "fixture"))),
                   "microduck_local.behaviors": SimpleNamespace(BehaviorEnv=Environment)}
        self.run["spec"].update(behaviorId="imitate", weights={})
        environments = []
        with patch.dict(sys.modules, modules), patch.object(bridge, "bam_settings", return_value={}):
            for fall_step, expected in ((None, 1000), (160, 160)):
                inference_calls.clear()
                report, frames = self.provider.rollout((self.policy_path, self.run, self.data, self.checksum),
                    self.provider.physics((None, self.run)), 1000, 7, [0, 0, 0], True)
                self.assertEqual(report["steps"], expected)
                self.assertEqual(len(inference_calls), expected)
                self.assertEqual(report["terminated"], fall_step is not None)
                self.assertEqual(frames[-1]["step"], expected)
                self.assertEqual(frames[-1]["time"], expected / 50)
                self.assertTrue(all(frame["telemetry"] == state for frame in frames))
                self.assertTrue(environments[-1].closed)

    def test_rollout_preserves_returned_observations_and_only_overlays_shipped_twist(self):
        class Environment:
            def __init__(env, *args, **kwargs):
                env.actuator_model = "bam"
                env.obs_noise = env.domain_rand = env.random_yaw = False
                env.action_delay = True
                env.bam = SimpleNamespace(p=self.bam["parameters"])
                env.twist_cmd = [0.0] * 3
                env.step_count = env.observation_calls = 0
                env.velocity = [0.25 + i for i in range(14)]
                env.previous_velocity = env.velocity[:]
                env.returned = []
                env.step_commands = []
                env.closed = False
                environments.append(env)

            def _get_obs(env):
                env.observation_calls += 1
                obs = [float(100 * env.step_count + i) for i in range(61)]
                obs[5] = -1.0
                obs[20:34] = env.previous_velocity
                env.previous_velocity = env.velocity[:]
                obs[48:51] = env.twist_cmd
                return obs

            def _return_observation(env):
                obs = env._get_obs()
                env.returned.append((obs, obs[:]))
                return obs

            def reset(env, seed):
                env.reset_seed = seed
                env.twist_cmd[:] = [7.0, 8.0, 9.0]
                return env._return_observation(), {}

            def step(env, action):
                env.step_commands.append(env.twist_cmd[:])
                env.step_count += 1
                env.velocity = [value + 10 for value in env.velocity]
                env.twist_cmd[:] = [7.0 + env.step_count, 8.0, 9.0]
                return env._return_observation(), 1.0, False, env.step_count == 3, {}

            def close(env):
                env.closed = True

        numpy = SimpleNamespace(asarray=lambda value, **kwargs: value, float32="float32",
                                isfinite=lambda value: SimpleNamespace(all=lambda: True),
                                mean=lambda values: sum(values) / len(values))
        modules = {"numpy": numpy,
                   "microduck_local": SimpleNamespace(contract=SimpleNamespace(CTRL_DT=0.02),
                       bam_actuator=SimpleNamespace(load_bam_params=lambda: ({}, "fixture"))),
                   "microduck_local.walk_env": SimpleNamespace(MicroduckWalkEnv=Environment),
                   "microduck_local.behaviors": SimpleNamespace(BehaviorEnv=Environment)}
        self.run["spec"].update(behaviorId="imitate", weights={})
        environments = []
        commands = [[0.1, -0.2, 0.3], [-0.1, 0.2, -0.3], [0.0, 0.0, 0.0]]
        with patch.dict(sys.modules, modules), patch.object(bridge, "bam_settings", return_value={}):
            for run in (None, self.run):
                with self.subTest(owned=run is not None):
                    command = commands[0][:]
                    observed = []
                    inference_observations = []

                    def controller(obs, step):
                        inference_observations.append(obs)
                        observed.append(obs[:])
                        if step + 1 < len(commands):
                            command[:] = commands[step + 1]
                        return [0.0] * 14

                    report, frames = self.provider.rollout((None, run, None, None),
                        self.provider.physics((None, self.run)), 3, 7, command, False, controller=controller)
                    env = environments[-1]
                    self.assertTrue(env.closed)
                    self.assertEqual((report["steps"], frames, env.reset_seed), (3, [], 7))
                    self.assertEqual(env.observation_calls, 4, "reset and each step own one observation update")
                    self.assertEqual([obs[20] for obs in observed], [0.25, 0.25, 10.25])
                    for step, obs in enumerate(observed):
                        source, expected = env.returned[step]
                        expected = expected[:]
                        if run is None:
                            expected[48:51] = commands[step]
                            self.assertIsNot(inference_observations[step], source)
                        else:
                            self.assertIs(inference_observations[step], source)
                        self.assertEqual(obs, expected)
                        self.assertEqual(env.step_commands[step], expected[48:51])
                    for source, snapshot in env.returned:
                        self.assertEqual(source, snapshot, "command overlay must not mutate retained observations")

    def test_bridge_and_source_drift_reject_original_policy(self):
        for field, changed, message in (("bridgeSha256", "changed", "Python bridge"),
                                        ("sourceFingerprint", "changed", "fingerprint")):
            original = copy.deepcopy(self.run)
            if field == "bridgeSha256":
                self.run["provenance"][field] = changed
            else:
                self.run[field] = changed
            self.save_run()
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, message):
                self.provider.load_policy(self.policy_id)
            self.run = original

    def test_incompatible_history_remains_listed_without_allowing_inference(self):
        self.run["provenance"]["bridgeSha256"] = "original bridge"
        self.save_run()
        original_manifest = (self.path / "manifest.json").read_bytes()
        newer = copy.deepcopy(self.run)
        newer["id"] = "run-11111111-1111-1111-1111-111111111111"
        newer["policyId"] = "run:" + newer["id"]
        newer["provenance"]["bridgeSha256"] = bridge.bridge_hash()
        newer_path = self.provider.path(newer["id"])
        bridge.write_json(newer_path / "manifest.json", newer)
        (newer_path / "policy.onnx").write_bytes(self.data)
        policies = {policy["id"]: policy for policy in self.provider.policies()}
        self.assertEqual(set(policies), {self.policy_id, newer["policyId"]})
        self.assertEqual(policies[self.policy_id]["sha256"], self.checksum)
        self.assertFalse(policies[self.policy_id]["runtimeCompatibility"]["available"])
        self.assertIn("Python bridge", policies[self.policy_id]["runtimeCompatibility"]["reason"])
        self.assertTrue(policies[newer["policyId"]]["runtimeCompatibility"]["available"])
        self.assertEqual(self.provider.load_policy(newer["policyId"])[3], self.checksum)
        for operation in (lambda: self.provider.simulate({"policyId": self.policy_id, "steps": 10, "seed": 1, "command": [0, 0, 0]}),
                          lambda: self.provider.evaluate(self.evaluation_spec())):
            with self.assertRaisesRegex(ValueError, "Python bridge"):
                operation()
        self.assertFalse((self.root / "evaluations").exists())
        self.assertEqual((self.path / "manifest.json").read_bytes(), original_manifest)
        self.assertEqual(self.policy_path.read_bytes(), self.data)

    def test_run_inspection_does_not_publish_an_uncommitted_policy(self):
        self.run.update(state="running", policyId=None, policySha256=None)
        self.save_run()
        self.assertIsNone(self.provider.run(self.run_id)["policyId"])

    def test_completed_state_and_hash_share_one_manifest_commit(self):
        def train():
            self.policy_path.write_bytes(b"newly exported policy")
        trainer = SimpleNamespace(main=train)
        modules = {"microduck_local": SimpleNamespace(train_behavior=trainer),
                   "microduck_local.behaviors": SimpleNamespace(BehaviorEnv=object)}
        self.run["spec"].update(behaviorId="stand", actuator="bam", steps=10, envs=1, seed=0, weights={})
        self.run["recipeHash"] = bridge.digest(self.run["spec"])
        self.run.update(state="starting", policyId=None, policySha256=None)
        self.select_backend("cpu")
        self.provider.limits["snapshotSteps"] = 10
        writes = []
        original = bridge.write_json
        def record(path, value):
            if path.name == "manifest.json":
                writes.append(copy.deepcopy(value))
            original(path, value)
        with (patch.dict(sys.modules, modules), patch.object(bridge, "write_json", side_effect=record), patch.object(sys, "argv", []),
              patch.object(bridge, "runtime_versions", return_value={}),
              patch.object(bridge, "trainer_provenance", return_value=self.run["provenance"]["trainer"])):
            self.provider.train(self.run_id)
        self.assertEqual([row["state"] for row in writes], ["running", "completed"])
        self.assertIsNone(writes[0]["policySha256"])
        self.assertEqual(writes[1]["policySha256"], hashlib.sha256(b"newly exported policy").hexdigest())

    def test_bam_value_and_source_drift_rejected_before_loading(self):
        for key, value in (("source", "fallback"), ("parameters", {"kt": 99})):
            changed = {"source": self.bam["source"], "parameters": self.bam["parameters"], key: value}
            changed["sha256"] = bridge.digest(changed)
            with patch.object(bridge, "bam_provenance", return_value=changed), self.subTest(key=key):
                with self.assertRaisesRegex(ValueError, "effective BAM"):
                    self.provider.load_policy(self.policy_id)

    def test_tampered_frozen_bam_hash_rejected(self):
        self.run["provenance"]["bam"]["parameters"]["kt"] = 12
        self.save_run()
        with self.assertRaisesRegex(ValueError, "BAM hash"):
            self.provider.load_policy(self.policy_id)

    def test_frozen_bam_constructor_does_not_reopen_installed_data(self):
        def changed_loader():
            raise AssertionError("installed data must not reopen")
        module = SimpleNamespace(load_bam_params=changed_loader)
        with patch.dict(sys.modules, {"microduck_local": SimpleNamespace(bam_actuator=module)}):
            with bridge.frozen_bam(self.bam):
                values, source = module.load_bam_params()
                self.assertEqual(values, self.bam["parameters"])
                self.assertEqual(source, self.bam["source"])
                values["kt"] = 999
                self.assertNotEqual(module.load_bam_params()[0]["kt"], 999)
            self.assertIs(module.load_bam_params, changed_loader)

    def test_concurrent_evaluations_keep_distinct_criteria_before_execution(self):
        rendezvous = Barrier(2)
        specs = [self.evaluation_spec(), {**self.evaluation_spec(), "minMeanUprightFraction": 0.1}]
        def rollout(loaded, physics, *args):
            rendezvous.wait(timeout=10)
            requests = list((self.root / "evaluations").glob("eval-*/request.json"))
            self.assertEqual(len(requests), 2)
            records = [json.loads(path.read_text()) for path in requests]
            self.assertEqual({record["spec"]["minMeanUprightFraction"] for record in records}, {0.1, 0.9})
            for record in records:
                self.assertEqual(record["policyHash"], loaded[3])
                self.assertEqual(record["physics"], physics)
            return {"terminated": False, "uprightFraction": 0.5, "bamSettings": {}}, []
        with patch.object(self.provider, "rollout", side_effect=rollout), ThreadPoolExecutor(2) as pool:
            reports = list(pool.map(self.provider.evaluate, specs))
        self.assertEqual({report["passed"] for report in reports}, {True, False})
        self.assertNotEqual(reports[0]["id"], reports[1]["id"])
        for report in reports:
            path = self.root / "evaluations" / report["id"]
            self.assertEqual(json.loads((path / "report.json").read_text()), report)
            self.assertEqual(json.loads((path / "request.json").read_text())["spec"], report["spec"])
        self.assertEqual(self.provider.policy(self.policy_id)["verification"], "evaluated")

    def test_failed_rollout_keeps_admission_without_publishing_evidence(self):
        with patch.object(self.provider, "rollout", side_effect=ValueError("rollout failed")):
            with self.assertRaisesRegex(ValueError, "rollout failed"):
                self.provider.evaluate(self.evaluation_spec())
        self.assertEqual(len(list((self.root / "evaluations").glob("eval-*/request.json"))), 1)
        self.assertEqual(list((self.root / "evaluations").glob("eval-*/report.json")), [])
        self.assertEqual(self.provider.policy(self.policy_id)["verification"], "unverified")

    def test_shipped_policy_evidence_persists_and_follows_exact_hash(self):
        path = self.provider.source / "microduck/policies/alpha_stand.onnx"
        path.parent.mkdir(parents=True)
        path.write_bytes(self.data)
        spec = self.evaluation_spec("shipped:alpha_stand")
        with patch.object(self.provider, "rollout", return_value=({"terminated": False, "uprightFraction": 1, "bamSettings": {}}, [])):
            report = self.provider.evaluate(spec)
        report_path = self.root / "evaluations" / report["id"] / "report.json"
        self.assertTrue(report_path.is_file())
        expected = json.loads((Path(__file__).parent / "expected/evaluation-limitations.json").read_text())
        self.assertEqual(report["limitations"], expected)
        self.assertEqual(json.loads(report_path.read_text())["limitations"], expected)
        self.assertEqual(self.provider.policy(spec["policyId"])["verification"], "evaluated")
        path.write_bytes(b"different shipped policy")
        self.assertEqual(self.provider.policy(spec["policyId"])["verification"], "unverified")

    def test_concurrent_atomic_writes_use_unique_private_temporary_files(self):
        rendezvous = Barrier(2)
        seen = []
        original = Path.replace
        def replace(path, target):
            seen.append(path)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            rendezvous.wait(timeout=10)
            return original(path, target)
        path = self.root / "atomic.json"
        with patch.object(Path, "replace", replace), ThreadPoolExecutor(2) as pool:
            list(pool.map(lambda value: bridge.write_json(path, {"value": value}), (1, 2)))
        self.assertEqual(len(set(seen)), 2)
        self.assertIn(json.loads(path.read_text())["value"], (1, 2))
        self.assertTrue(all(not path.exists() for path in seen))


if __name__ == "__main__":
    unittest.main()
