"""Dependency-free telemetry orchestration: no MLX, optimization or simulation."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import test_rlx_ppo as existing

rlx, bridge = existing.rlx, existing.bridge
FIELDS = {"version", "completedRollouts", "optimizerSteps", "lastMeanLoss", "collectionSeconds",
          "updateSeconds", "checkpointSeconds", "exportSeconds"}


class ObserverTests(unittest.TestCase):
    def test_accumulates_completed_events_without_writing_and_keeps_last_loss(self):
        stream = io.StringIO()
        diagnostics = rlx._TrainingDiagnostics(2, 10, 100, None)
        report = rlx._RlxProgress(stream, 2, 10, 5, 0.0, diagnostics)
        self.assertEqual(set(report.metrics), FIELDS)
        self.assertIsNone(report.metrics["lastMeanLoss"])
        report.observe({"phase": "collection", "steps": 2, "seconds": 1.5})
        self.assertEqual(report.metrics["completedRollouts"], 0)
        report.observe({"phase": "update", "steps": 2, "seconds": 2.5, "optimizer_steps": 3, "mean_loss": 5.0})
        report.observe({"phase": "collection", "steps": 4, "seconds": 0.0})
        report.observe({"phase": "update", "steps": 4, "seconds": 1.0, "optimizer_steps": 2, "mean_loss": -2.0})
        self.assertEqual(stream.getvalue(), "")
        self.assertEqual(report.metrics, {"version": 1, "completedRollouts": 2, "optimizerSteps": 5,
            "lastMeanLoss": -2.0, "collectionSeconds": 1.5, "updateSeconds": 3.5,
            "checkpointSeconds": None, "exportSeconds": None})
        with patch.object(rlx.time, "monotonic", return_value=10.0):
            for prior in (0, 2, 4, 6):
                info = {"episode": {"r": [3.0, 100.0], "l": [1, prior // 2 + 1]},
                        "_episode": [True, False], "infos": [{}, {}]}
                report.on_step(info, prior)
        rows = [json.loads(line) for line in stream.getvalue().splitlines()]
        self.assertEqual([row["steps"] for row in rows], [2, 8])
        self.assertTrue(all(row["ep_rew"] == 3 for row in rows))
        self.assertTrue(all(set(row["rlx"]) == FIELDS for row in rows))
        with self.assertRaisesRegex(ValueError, "observer phase"):
            report.observe({"phase": "unknown"})


class OrchestrationTests(unittest.TestCase):
    def exercise(self, failure=None, reference=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            clock, order = [100.0], []
            raw = SimpleNamespace(close=lambda: order.append("closed"))
            expected_source = {"sha256": "f" * 64, "fileCount": 1}
            recipe = {**existing.CONFIG, "horizon": 1, "numMinibatches": 1, "epochs": 1,
                      "actualSteps": 20, "batchSize": 1, "episodeSteps": 4, "source": expected_source}
            spec = {**existing.SPEC, "envs": 1, "steps": 20}
            if reference:
                spec["clip"] = {"version": 1, "duration": 0.14, "loop": True,
                                "keys": [{"t": 0, "joints": [0.0] * 14}, {"t": 0.14, "joints": [0.1] * 14}]}
                (root / "clips").mkdir()
                (root / "clips/reference.json").write_text(json.dumps(spec["clip"]))
            test = self

            class Adapter:
                def __init__(self, *_args, **kwargs):
                    test.assertEqual(kwargs, {"normalize_observations": True, "normalize_rewards": False,
                        "gamma": recipe["gamma"], "epsilon": recipe["normalizationEpsilon"], "clip": recipe["observationClip"]})
                    self.observation_rms = SimpleNamespace(mean=[0.0] * 61, var=[1.0] * 61, count=20)
                    self.observation_space, self.action_space = "observation-space", "action-space"
                    self.epsilon, self.clip = kwargs["epsilon"], kwargs["clip"]

            class Algorithm:
                def __init__(self, **kwargs):
                    test.assertEqual(vars(kwargs["config"]), {"num_envs": 1, "num_steps": 1, "num_minibatches": 1,
                        "update_epochs": 1, "gamma": recipe["gamma"], "gae_lambda": recipe["gaeLambda"],
                        "normalize_advantages": recipe["normalizeAdvantages"], "clip_coefficient": recipe["clipCoefficient"],
                        "clip_value_loss": recipe["clipValueLoss"], "entropy_coefficient": recipe["entropyCoefficient"],
                        "value_coefficient": recipe["valueCoefficient"], "max_grad_norm": recipe["maxGradNorm"]})
                    test.assertEqual(kwargs["key"], spec["seed"])
                    self.step = 0

                def train(self, steps, callback=None, *, observer=None):
                    test.assertIsNotNone(observer)
                    for index in range(steps):
                        clock[0] += 1.0
                        if failure != "missing-final-callback" or index != steps - 1:
                            callback({"episode": {"r": [float(index + 1)], "l": [index % 4 + 1]},
                                      "_episode": [(index + 1) % 4 == 0], "infos": [{}]}, self.step)
                        if failure == "buffer" or (failure == "buffer-unsampled" and index == 1):
                            clock[0] += 0.5
                            raise RuntimeError("buffer failed after callback")
                        self.step += 1
                        if failure != "missing-observer":
                            observer({"phase": "collection", "steps": 1, "seconds": 1.0})
                        if failure == "update" and index == 0:
                            clock[0] += 0.5
                            raise RuntimeError("update failed")
                        clock[0] += 2.0
                        if failure != "missing-observer":
                            observer({"phase": "update", "steps": 1, "seconds": 2.0,
                                      "optimizer_steps": 0 if failure == "optimizer" else 1, "mean_loss": -float(self.step)})
                    if failure == "budget":
                        self.step -= 1

            def checkpoint(path, *_args, **kwargs):
                order.append("checkpoint")
                self.assertFalse(kwargs["metadata"]["resumable"])
                self.assertEqual(_args[1:], ([0.0] * 61, [1.0] * 61, 20))
                self.assertEqual((kwargs["epsilon"], kwargs["clip"]), (recipe["normalizationEpsilon"], recipe["observationClip"]))
                snapshot = kwargs["metadata"]["trainingDiagnostics"]
                self.assertEqual((snapshot["version"], snapshot["observedTransitions"], snapshot["collectionComplete"]), (1, 20, True))
                self.assertEqual(snapshot["completedEpisodes"]["terminated"], {"count": 5, "lengthSum": 20,
                    "minLength": 4, "maxLength": 4, "histogramCounts": [0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0]})
                self.assertEqual(snapshot["rightCensoredEpisodeLengths"], [0])
                if reference:
                    self.assertEqual(snapshot["referenceExposure"]["clipSteps"], 7)
                    self.assertEqual(snapshot["referenceExposure"]["binCounts"], [5 if index in (4, 9, 13, 18) else 0 for index in range(32)])
                else:
                    self.assertIsNone(snapshot["referenceExposure"])
                    self.assertIn("not measured", snapshot["referenceExposureUnavailableReason"])
                clock[0] += 5.0
                if failure == "checkpoint":
                    raise RuntimeError("checkpoint failed")
                path.write_bytes(b"mock checkpoint")
                path.with_suffix(path.suffix + ".json").write_text(json.dumps({"metadata": kwargs["metadata"]}))

            def load_clip(name, directory):
                self.assertEqual(order, ["cpu-workers-before-numeric-imports"])
                self.assertEqual((name, directory), ("reference", root / "clips"))
                self.assertEqual(json.loads((directory / "reference.json").read_text()), spec["clip"])
                return SimpleNamespace(steps=7, loop=True)

            def export(path, *_args):
                order.append("export")
                clock[0] += 11.0
                if failure == "export":
                    raise RuntimeError("export failed")
                (path / "policy.onnx").write_bytes(b"mock export; not a learned policy")

            def source(_path):
                clock[0] += 7.0
                return {"sha256": "changed"} if failure == "source" else expected_source

            mx = SimpleNamespace(gpu="mock-gpu", set_default_device=lambda _device: order.append("numeric-device"),
                                 random=SimpleNamespace(seed=lambda _seed: None, key=lambda seed: seed), eval=lambda *_args: None)
            optim = SimpleNamespace(Adam=lambda **_kwargs: object())
            modules = {
                "microduck_local.motion": SimpleNamespace(load_clip=load_clip),
                "numpy": SimpleNamespace(random=SimpleNamespace(seed=lambda _seed: None)),
                "mlx": SimpleNamespace(core=mx, optimizers=optim), "mlx.core": mx, "mlx.optimizers": optim,
                "rlx.algorithms.ppo": SimpleNamespace(PPO=Algorithm, PPOConfig=lambda **kwargs: SimpleNamespace(**kwargs)),
                "rlx.buffers.rollout_buffer": SimpleNamespace(RolloutBuffer=lambda *_args, **_kwargs: object()),
                "rlx.environments.microduck": SimpleNamespace(MicroDuckVecEnv=Adapter),
                "rlx.models.microduck": SimpleNamespace(create_actor_critic=lambda: SimpleNamespace(parameters=lambda: {}),
                                                         save_checkpoint=checkpoint),
            }

            def make_vec(factories, *, backend):
                self.assertEqual(backend, "fork")
                self.assertEqual(len(factories), 1)
                self.assertNotIn("mlx.core", sys.modules)
                self.assertNotIn("torch", sys.modules)
                order.append("cpu-workers-before-numeric-imports")
                sys.modules.update(modules)
                return raw

            before = {key: sys.modules.get(key) for key in [*modules, "microduck_local.vec_env", "torch"]}
            with (patch.dict(sys.modules, {"microduck_local.vec_env": SimpleNamespace(make_vec_env=make_vec)}),
                  patch.object(rlx, "_activate"), patch.object(rlx, "source_fingerprint", side_effect=source),
                  patch.object(rlx, "export_policy", side_effect=export),
                  patch.object(rlx.time, "monotonic", side_effect=lambda: clock[0])):
                # The fixture models a fresh process; patch.dict restores any inherited modules.
                sys.modules.pop("mlx.core", None)
                sys.modules.pop("torch", None)
                if failure:
                    pattern = {"update": "update failed", "checkpoint": "checkpoint failed", "export": "export failed",
                               "source": "source changed", "budget": "collected steps", "missing-observer": "observer intervals",
                               "optimizer": "optimizer steps", "buffer": "buffer failed after callback",
                               "buffer-unsampled": "buffer failed after callback", "missing-final-callback": "diagnostics do not account"}[failure]
                    with self.assertRaisesRegex((RuntimeError, ValueError), pattern):
                        rlx.train(root, spec, lambda *_args: lambda: None, 5, recipe, str(root))
                else:
                    rlx.train(root, spec, lambda *_args: lambda: None, 5, recipe, str(root))
            for key, module in before.items():
                self.assertIs(sys.modules.get(key), module)
            self.assertEqual(order[0], "cpu-workers-before-numeric-imports")
            self.assertEqual(order[-1], "closed")
            rows = [json.loads(line) for line in (root / "progress.jsonl").read_text().splitlines()]
            self.assertTrue(all(set(row["rlx"]) == FIELDS for row in rows))
            self.assertTrue(all(len(json.dumps(row)) < 5000 for row in rows))
            self.assertEqual((root / "policy.onnx").exists(), failure is None)
            if (root / "rlx.safetensors.json").exists():
                metadata = json.loads((root / "rlx.safetensors.json").read_text())["metadata"]
                self.assertEqual(metadata["trainingDiagnostics"], rows[-1]["trainingDiagnostics"])
                self.assertEqual(set(metadata), {"recipe", "requestedSteps", "actualSteps", "normalizerArtifact", "resumable", "trainingDiagnostics"})
            return rows, order

    def test_cadence_final_update_and_export_preserve_training_clock(self):
        rows, order = self.exercise()
        self.assertEqual([row["steps"] for row in rows], [1, 6, 11, 16, 20, 20])
        self.assertEqual(rows[0]["rlx"], {"version": 1, "completedRollouts": 0, "optimizerSteps": 0,
            "lastMeanLoss": None, "collectionSeconds": 0.0, "updateSeconds": 0.0,
            "checkpointSeconds": None, "exportSeconds": None})
        self.assertEqual(rows[-1]["rlx"], {"version": 1, "completedRollouts": 20, "optimizerSteps": 20,
            "lastMeanLoss": -20.0, "collectionSeconds": 20.0, "updateSeconds": 40.0,
            "checkpointSeconds": 5.0, "exportSeconds": 11.0})
        self.assertEqual([row["elapsed_s"] for row in rows[-2:]], [60.0, 60.0])
        self.assertIsNone(rows[-2]["rlx"]["checkpointSeconds"])
        self.assertIsNone(rows[-2]["rlx"]["exportSeconds"])
        self.assertEqual(rows[-1]["ep_rew"], 12.0)
        self.assertEqual(order.count("export"), 1)

    def test_runtime_clip_diagnostics_are_loaded_after_fork_and_retained_only_in_raw_metadata(self):
        rows, _order = self.exercise(reference=True)
        self.assertEqual([row["steps"] for row in rows], [1, 6, 11, 16, 20, 20])
        self.assertEqual(rows[-1]["trainingDiagnostics"]["referenceExposure"]["clipSteps"], 7)
        self.assertEqual(rows[-1]["trainingDiagnostics"]["episodeStepLimit"], 4)

    def test_failed_checkpoint_source_or_export_never_claims_completed_export(self):
        for failure in ("checkpoint", "source", "export"):
            with self.subTest(failure=failure):
                rows, _order = self.exercise(failure)
                self.assertIsNone(rows[-1]["rlx"]["exportSeconds"])
                self.assertEqual(rows[-1]["rlx"]["checkpointSeconds"], None if failure == "checkpoint" else 5.0)
                self.assertEqual([row["elapsed_s"] for row in rows[-2:]], [60.0, 60.0])

    def test_failed_update_reports_only_completed_intervals_and_no_checkpoint(self):
        rows, order = self.exercise("update")
        self.assertEqual(rows[-1]["rlx"]["collectionSeconds"], 1.0)
        self.assertEqual(rows[-1]["rlx"]["updateSeconds"], 0.0)
        self.assertEqual(rows[-1]["rlx"]["completedRollouts"], 0)
        self.assertIsNone(rows[-1]["rlx"]["lastMeanLoss"])
        self.assertIsNone(rows[-1]["rlx"]["checkpointSeconds"])
        self.assertNotIn("checkpoint", order)

    def test_failure_after_callback_retains_observed_transitions_before_buffer_commit(self):
        for failure, steps, completed in (("buffer", 1, 0), ("buffer-unsampled", 2, 1)):
            with self.subTest(failure=failure):
                rows, order = self.exercise(failure)
                self.assertEqual([row["steps"] for row in rows], [1, steps])
                self.assertEqual(rows[-1]["trainingDiagnostics"]["observedTransitions"], steps)
                self.assertFalse(rows[-1]["trainingDiagnostics"]["collectionComplete"])
                self.assertEqual(rows[-1]["trainingDiagnostics"]["rightCensoredEpisodeLengths"], [steps])
                self.assertEqual(rows[-1]["rlx"]["completedRollouts"], completed)
                self.assertEqual(rows[-1]["rlx"]["collectionSeconds"], float(completed))
                self.assertEqual(rows[-1]["rlx"]["updateSeconds"], float(completed * 2))
                self.assertIsNone(rows[-1]["rlx"]["checkpointSeconds"])
                self.assertIsNone(rows[-1]["rlx"]["exportSeconds"])
                self.assertNotIn("checkpoint", order)

    def test_wrong_step_budget_or_missing_observer_counts_stop_before_checkpoint(self):
        for failure in ("budget", "missing-observer", "optimizer", "missing-final-callback"):
            with self.subTest(failure=failure):
                _rows, order = self.exercise(failure)
                self.assertNotIn("checkpoint", order)


class ProbeObserverTests(unittest.TestCase):
    def test_disposable_probe_rejects_old_api_without_loading_real_numeric_modules(self):
        class Old:
            def train(self, steps, callback=None):
                pass

        class Current:
            def train(self, steps, callback=None, *, observer=None):
                pass

        class Array:
            def __add__(self, _value):
                return self

            def item(self):
                return 2

        mx = SimpleNamespace(metal=SimpleNamespace(is_available=lambda: True), gpu="mock-device",
                             set_default_device=lambda _device: None, array=lambda _value: Array(),
                             eval=lambda *_args: None, device_info=lambda: {"device_name": "mock Metal"})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ("pyproject.toml", "rlx/algorithms/ppo.py", "rlx/environments/microduck.py",
                         "rlx/models/microduck.py", "rlx/export/microduck_onnx.py"):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("# probe fixture\n")
            for algorithm in (Old, Current):
                def run(command, **_kwargs):
                    modules = {"mlx": SimpleNamespace(core=mx), "mlx.core": mx,
                               "rlx.algorithms.ppo": SimpleNamespace(PPO=algorithm, PPOConfig=object),
                               "rlx.environments.microduck": SimpleNamespace(MicroDuckVecEnv=object),
                               "rlx.models.microduck": SimpleNamespace(create_actor_critic=lambda: None),
                               "rlx.export.microduck_onnx": SimpleNamespace(export_deterministic_actor=lambda: None)}
                    output = io.StringIO()
                    with (patch.dict(sys.modules, modules), patch.object(sys, "argv", ["-c", str(root)]),
                          patch.object(sys, "path", list(sys.path)), contextlib.redirect_stdout(output)):
                        try:
                            exec(command[3], {"__name__": "__main__"})
                        except AssertionError as error:
                            return SimpleNamespace(returncode=1, stderr=str(error), stdout=output.getvalue())
                    return SimpleNamespace(returncode=0, stderr="", stdout=output.getvalue())
                with (self.subTest(api=algorithm.__name__), patch.object(rlx.subprocess, "run", side_effect=run),
                      patch.object(rlx.platform, "system", return_value="Darwin"),
                      patch.object(rlx.platform, "machine", return_value="arm64"),
                      patch.object(rlx.sys, "version_info", (3, 12))):
                    if algorithm is Old:
                        with self.assertRaisesRegex(ValueError, "keyword-only observer"):
                            rlx.probe(str(root))
                    else:
                        self.assertEqual(rlx.probe(str(root)), "mock Metal")


class BridgeProgressTests(unittest.TestCase):
    def test_legacy_progress_has_no_invented_rlx_and_present_payload_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            provider = object.__new__(bridge.Bridge)
            provider.root = Path(temporary).resolve()
            run_id = "run-00000000-0000-0000-0000-000000000000"
            root = provider.path(run_id)
            root.mkdir(parents=True)
            for backend in ("cpu", "mlx", "rlx"):
                device = "cpu" if backend == "cpu" else "metal"
                trainer = {"backend": backend, "learnerDevice": device, "physicsDevice": "cpu",
                           "helperSha256": {} if backend == "cpu" else {backend + "_ppo.py": "f" * 64}}
                trainer["sha256"] = bridge.digest(trainer)
                spec = {"backend": backend}
                manifest = {"formatVersion": 3, "spec": spec, "recipeHash": bridge.digest(spec), "progress": None,
                            "provenance": {"trainer": trainer, "environment": {"updateDevice": device}}}
                (root / "manifest.json").write_text(json.dumps(manifest))
                for payload in ({}, {"rlx": None}, {"rlx": {"version": 1, "lastMeanLoss": None}}):
                    with self.subTest(backend=backend, payload=payload):
                        raw = {"steps": 1, "total": 2, "elapsed_s": 0.0, "ep_rew": None,
                               "trainingDiagnostics": {"version": 1, "observedTransitions": 1}, **payload}
                        (root / "progress.jsonl").write_text(json.dumps(raw) + "\n{partial")
                        self.assertEqual(provider.run(run_id)["progress"],
                            {"steps": 1, "total": 2, "elapsedSeconds": 0.0, "reward": None, **payload})
                (root / "progress.jsonl").write_text(json.dumps(raw) + "\n" + json.dumps({
                    "steps": 2, "total": 2, "elapsed_s": 1.0, "ep_rew": 0.0}) + "\n")
                self.assertNotIn("rlx", provider.run(run_id)["progress"])


if __name__ == "__main__":
    unittest.main()
