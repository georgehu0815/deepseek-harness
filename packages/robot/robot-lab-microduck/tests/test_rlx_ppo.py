"""Dependency-free RLX admission/provenance tests; optional real export checks."""
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

PYTHON = Path(__file__).parents[1] / "python"


def load(name):
    spec = importlib.util.spec_from_file_location(name, PYTHON / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rlx = load("rlx_ppo")
bridge = load("bridge")
CONFIG = {"horizon": 24, "numMinibatches": 4, "epochs": 5, "learningRate": 0.0003,
          "gamma": 0.99, "gaeLambda": 0.95, "normalizeAdvantages": True,
          "clipCoefficient": 0.2, "clipValueLoss": True, "entropyCoefficient": 0.01,
          "valueCoefficient": 1.0, "maxGradNorm": 0.5, "observationClip": 10.0,
          "normalizationEpsilon": 1e-8, "minimumEpisodeSeconds": 4.0}
SPEC = {"name": "test", "backend": "rlx", "behaviorId": "stand", "steps": 4,
        "envs": 2, "seed": 1, "actuator": "bam", "weights": {}, "clip": None}


class RecipeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        for name in ("pyproject.toml", "rlx/algorithms/ppo.py", "rlx/environments/microduck.py",
                     "rlx/models/microduck.py", "rlx/export/microduck_onnx.py"):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("# test source\n")
        self.limits = {"rlxSourceRoot": str(self.root), "rlxPpo": dict(CONFIG), "maxTrainingSteps": 1000}
        self.control = SimpleNamespace(CTRL_DT=0.02)
        patcher = patch.dict(sys.modules, {"microduck_local.contract": self.control})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_resolves_small_batches_and_preserves_explicit_configuration(self):
        result = rlx.recipe(SPEC, self.limits)
        self.assertEqual(result["version"], "rlx-microduck-ppo-v1")
        self.assertEqual((result["horizon"], result["numMinibatches"], result["actualSteps"]), (2, 4, 4))
        self.assertEqual(result["episodeSeconds"], 4)
        self.assertEqual(self.limits["rlxPpo"], CONFIG)
        self.assertEqual(result["source"], rlx.source_fingerprint(str(self.root)))

    def test_full_rollouts_round_up_and_admission_rejects_resource_overflow(self):
        spec = {**SPEC, "steps": 49}
        result = rlx.recipe(spec, self.limits)
        self.assertEqual((result["requestedSteps"], result["actualSteps"]), (49, 96))
        with self.assertRaisesRegex(ValueError, "maxTrainingSteps"):
            rlx.recipe(spec, {**self.limits, "maxTrainingSteps": 95})

    def test_minibatches_resolve_to_divisor_and_routine_sets_episode_length(self):
        config = {**CONFIG, "horizon": 5, "numMinibatches": 4}
        result = rlx.recipe({**SPEC, "steps": 9, "clip": {"duration": 20.0}}, {**self.limits, "rlxPpo": config})
        self.assertEqual((result["numMinibatches"], result["batchSize"], result["episodeSeconds"]), (2, 10, 20))
        result = rlx.recipe({**SPEC, "steps": 1}, self.limits)
        self.assertEqual((result["numMinibatches"], result["actualSteps"]), (2, 2))

    def test_episode_duration_rounds_up_using_installed_control_dt(self):
        cases = [(None, 0.05, 0.02, 3), (0.05, 0.02, 0.02, 3),
                 (0.14, 0.02, 0.02, 7), (0.035, 0.02, 0.01, 4),
                 (None, 0.011, 0.003, 4), (20.0, 4.0, 0.02, 1000)]
        for duration, minimum, dt, expected in cases:
            for training_steps in (1, 49):
                with self.subTest(duration=duration, minimum=minimum, dt=dt, training_steps=training_steps):
                    self.control.CTRL_DT = dt
                    spec = {**SPEC, "steps": training_steps, "clip": {"duration": duration} if duration else None}
                    config = {**CONFIG, "minimumEpisodeSeconds": minimum}
                    result = rlx.recipe(spec, {**self.limits, "rlxPpo": config})
                    requested = max(minimum, duration or 0)
                    self.assertEqual(result["requestedEpisodeSeconds"], requested)
                    self.assertEqual(result["controlDtSeconds"], dt)
                    self.assertEqual(result["episodeSteps"], expected)
                    self.assertEqual(result["episodeSeconds"], expected * dt)
                    self.assertGreaterEqual(result["episodeSeconds"], requested)
                    self.assertLess((expected - 1) * dt, requested)
                    self.assertEqual(result["requestedSteps"], training_steps)
                    self.assertEqual(result["actualSteps"], 2 if training_steps == 1 else 96)

    def test_rejects_invalid_simulator_control_dt(self):
        for dt in (0, -0.02, True, float("nan"), float("inf")):
            self.control.CTRL_DT = dt
            with self.subTest(dt=dt), self.assertRaisesRegex(ValueError, "CTRL_DT"):
                rlx.recipe(SPEC, self.limits)

    def test_configuration_requires_every_field_and_rejects_unknown_fields(self):
        for config in (None, {}, {**CONFIG, "extra": 1}):
            with self.subTest(config=config), self.assertRaisesRegex(ValueError, "complete"):
                rlx.recipe(SPEC, {**self.limits, "rlxPpo": config})
        for field in CONFIG:
            config = dict(CONFIG)
            del config[field]
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "complete"):
                rlx.recipe(SPEC, {**self.limits, "rlxPpo": config})

    def test_rejects_invalid_config_values(self):
        values = {"horizon": 0, "numMinibatches": True, "epochs": 1.5, "learningRate": 0,
                  "gamma": 1.1, "gaeLambda": -1, "normalizeAdvantages": 1, "clipCoefficient": 0,
                  "clipValueLoss": "true", "entropyCoefficient": -1, "valueCoefficient": -1,
                  "maxGradNorm": 0, "observationClip": float("inf"), "normalizationEpsilon": float("nan"),
                  "minimumEpisodeSeconds": False}
        for key, value in values.items():
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, key):
                rlx.recipe(SPEC, {**self.limits, "rlxPpo": {**CONFIG, key: value}})

    def test_fingerprint_observes_dirty_source_and_dependency_lock(self):
        first = rlx.source_fingerprint(str(self.root))
        (self.root / "rlx/algorithms/ppo.py").write_text("# changed\n")
        second = rlx.source_fingerprint(str(self.root))
        self.assertNotEqual(first["sha256"], second["sha256"])
        (self.root / "uv.lock").write_text("version = 1\n")
        third = rlx.source_fingerprint(str(self.root))
        self.assertNotEqual(second["sha256"], third["sha256"])
        self.assertEqual(third["fileCount"], second["fileCount"] + 1)

    def test_source_must_be_absolute_and_contained(self):
        for value in (None, "relative", 3):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "absolute"):
                rlx.source_root(value)
        with tempfile.TemporaryDirectory() as external:
            target = Path(external) / "external.py"
            target.write_text("# outside\n")
            (self.root / "rlx/escape.py").symlink_to(target)
            with self.assertRaisesRegex(ValueError, "escapes"):
                rlx.source_fingerprint(str(self.root))

    def test_rlx_probe_initializes_only_child_and_reports_failure(self):
        with (patch.object(rlx.platform, "system", return_value="Darwin"),
              patch.object(rlx.platform, "machine", return_value="arm64"),
              patch.object(rlx.sys, "version_info", (3, 12)),
              patch.object(rlx.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout='{"device_name":"test Metal"}')) as run):
            self.assertEqual(rlx.probe(str(self.root)), "test Metal")
            self.assertEqual(run.call_args.args[0][-1], str(self.root))
            self.assertEqual(run.call_args.args[0][:2], [sys.executable, "-B"])
            run.return_value = SimpleNamespace(returncode=1, stderr="missing MLX")
            with self.assertRaisesRegex(ValueError, "missing MLX"):
                rlx.probe(str(self.root))

    def test_helper_import_does_not_initialize_numeric_runtimes(self):
        code = "import sys; sys.path.insert(0,sys.argv[1]); import rlx_ppo; assert not any(k.split('.')[0] in {'mlx','torch','numpy','rlx'} for k in sys.modules)"
        result = subprocess.run([sys.executable, "-B", "-c", code, str(PYTHON)], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_train_rejects_preinitialized_runtime_before_workers(self):
        with patch.dict(sys.modules, {"mlx.core": SimpleNamespace()}):
            with self.assertRaisesRegex(RuntimeError, "fresh-process"):
                rlx.train(self.root, SPEC, None, 1, {}, str(self.root))

    def test_trainer_provenance_keeps_rlx_identity_and_helper_distinct(self):
        with (patch.dict(sys.modules, {"rlx_ppo": rlx}),
              patch.object(bridge, "dependency_versions", return_value={}),
              patch.object(bridge.importlib.metadata, "version", return_value="1.0"),
              patch.object(rlx, "probe", return_value="test Metal")):
            provenance = bridge.trainer_provenance(SPEC, self.limits)
        self.assertEqual(provenance["backend"], "rlx")
        self.assertEqual(provenance["learnerDevice"], "metal")
        self.assertEqual(set(provenance["helperSha256"]), {"rlx_ppo.py"})
        self.assertEqual(provenance["recipe"]["source"], rlx.source_fingerprint(str(self.root)))
        self.assertEqual(provenance["sha256"], bridge.digest({k: v for k, v in provenance.items() if k != "sha256"}))


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.hashes = {}
        for name in ("rlx.safetensors", "rlx.safetensors.json", "normalizer.npz", "export-parity.json", "policy.onnx"):
            data = name.encode()
            (self.root / name).write_bytes(data)
            self.hashes[name] = hashlib.sha256(data).hexdigest()
        self.write_manifest()

    def write_manifest(self):
        data = json.dumps({"version": 1, "sha256": self.hashes}).encode()
        (self.root / "rlx-artifacts.json").write_bytes(data)
        self.anchor = {"rlx-artifacts.json": hashlib.sha256(data).hexdigest()}

    def test_accepts_hash_bound_bundle_and_rejects_each_tampered_artifact(self):
        rlx.verify_artifacts(self.root, self.anchor, self.hashes["policy.onnx"])
        for name in self.hashes:
            path = self.root / name
            original = path.read_bytes()
            path.write_bytes(b"tampered")
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "hash mismatch"):
                rlx.verify_artifacts(self.root, self.anchor, self.hashes["policy.onnx"])
            path.write_bytes(original)

    def test_checkpoint_training_diagnostics_remain_bound_by_the_existing_artifact_manifest(self):
        report = rlx._TrainingDiagnostics(1, 2, 2, None)
        report.on_step({"episode": {"l": [1]}, "_episode": [False], "infos": [{}]}, 0)
        report.on_step({"episode": {"l": [2]}, "_episode": [True], "infos": [{"TimeLimit.truncated": True}]}, 1)
        sidecar = self.root / "rlx.safetensors.json"
        metadata = {"resumable": False, "trainingDiagnostics": report.snapshot()}
        sidecar.write_text(json.dumps({"metadata": metadata}))
        self.hashes[sidecar.name] = hashlib.sha256(sidecar.read_bytes()).hexdigest()
        self.write_manifest()
        rlx.verify_artifacts(self.root, self.anchor, self.hashes["policy.onnx"])
        self.assertEqual(json.loads((self.root / "rlx-artifacts.json").read_text())["version"], 1)
        self.assertEqual(set(self.hashes), {"rlx.safetensors", "rlx.safetensors.json", "normalizer.npz", "export-parity.json", "policy.onnx"})
        metadata["trainingDiagnostics"]["observedTransitions"] = 3
        sidecar.write_text(json.dumps({"metadata": metadata}))
        with self.assertRaisesRegex(ValueError, "rlx.safetensors.json"):
            rlx.verify_artifacts(self.root, self.anchor, self.hashes["policy.onnx"])
        original_anchor = dict(self.anchor)
        self.hashes[sidecar.name] = hashlib.sha256(sidecar.read_bytes()).hexdigest()
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "manifest hash"):
            rlx.verify_artifacts(self.root, original_anchor, self.hashes["policy.onnx"])

    def test_requires_frozen_manifest_and_rejects_changed_manifest_or_policy_binding(self):
        for anchor in (None, {}, {"../other": "f" * 64}):
            with self.subTest(anchor=anchor), self.assertRaisesRegex(ValueError, "artifactSha256"):
                rlx.verify_artifacts(self.root, anchor, self.hashes["policy.onnx"])
        with self.assertRaisesRegex(ValueError, "exported policy"):
            rlx.verify_artifacts(self.root, self.anchor, "0" * 64)
        (self.root / "rlx-artifacts.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "manifest hash"):
            rlx.verify_artifacts(self.root, self.anchor, self.hashes["policy.onnx"])

    def test_rejects_extra_paths_even_when_manifest_hash_matches(self):
        self.hashes["../outside"] = "0" * 64
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "exported policy"):
            rlx.verify_artifacts(self.root, self.anchor, self.hashes["policy.onnx"])

    def test_rejects_manifest_symlink_outside_owned_run(self):
        with tempfile.TemporaryDirectory() as temporary:
            outside = Path(temporary) / "manifest.json"
            path = self.root / "rlx-artifacts.json"
            outside.write_bytes(path.read_bytes())
            path.unlink()
            path.symlink_to(outside)
            with self.assertRaisesRegex(ValueError, "manifest escapes"):
                rlx.verify_artifacts(self.root, self.anchor, self.hashes["policy.onnx"])

    def test_bridge_verifies_rlx_bundle_before_returning_policy_bytes(self):
        run = {"state": "completed", "policyId": "run:test", "policySha256": self.hashes["policy.onnx"],
               "spec": {"backend": "rlx"}, "artifactSha256": self.anchor}
        provider = object.__new__(bridge.Bridge)
        with (patch.object(provider, "policy_path", return_value=(self.root / "policy.onnx", run)),
              patch.dict(sys.modules, {"rlx_ppo": rlx})):
            loaded = provider.inspect_policy("run:test")
            self.assertEqual(loaded[3], self.hashes["policy.onnx"])
            (self.root / "normalizer.npz").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "normalizer.npz"):
                provider.inspect_policy("run:test")


class CompletionProvenanceTests(unittest.TestCase):
    def exercise_completion(self, mutation=None):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            lab, source, python = root / "lab", root / "rlx", root / "python"
            targets = {
                "bridge": python / "bridge.py", "studio": python / "studio.py",
                "helper": python / "rlx_ppo.py", "local": lab / "microduck_local/src/contract.py",
                "model": lab / "microduck_rl/src/mjlab_microduck/robot/model.xml",
                "rlx": source / "rlx/algorithms/ppo.py",
            }
            paths = [*targets.values(), python / "dance_metrics.py", source / "pyproject.toml", source / "rlx/environments/microduck.py",
                     source / "rlx/models/microduck.py", source / "rlx/export/microduck_onnx.py"]
            for path in paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("# temporary source fixture\n")
            provider = object.__new__(bridge.Bridge)
            provider.source, provider.root = lab, root / "storage"
            provider.limits = {"rlxSourceRoot": str(source), "rlxPpo": {**CONFIG, "minimumEpisodeSeconds": 0.05},
                               "maxTrainingSteps": 1000, "snapshotSteps": 2}
            runtime = {}
            episode_times = []

            def environment(behavior_id, **kwargs):
                episode_times.append(kwargs["max_episode_s"])
                return SimpleNamespace(close=lambda: None, max_steps=round(kwargs["max_episode_s"] / 0.02))

            def exported_training(path, spec, make_env, snapshot_steps, recipe, configured_source):
                make_env(spec["behaviorId"], 0, spec["seed"], spec["weights"])()
                hashes = {}
                for name in ("rlx.safetensors", "rlx.safetensors.json", "normalizer.npz", "export-parity.json", "policy.onnx"):
                    data = name.encode()
                    (path / name).write_bytes(data)
                    hashes[name] = hashlib.sha256(data).hexdigest()
                (path / "rlx-artifacts.json").write_text(json.dumps({"version": 1, "sha256": hashes}))
                if mutation == "runtime":
                    runtime["numpy"] = "changed"
                elif mutation is not None:
                    targets[mutation].write_text("# changed after export\n")

            helper = SimpleNamespace(train=exported_training, source_fingerprint=rlx.source_fingerprint,
                                     verify_artifacts=rlx.verify_artifacts)
            modules = {"rlx_ppo": helper, "microduck_local.contract": SimpleNamespace(CTRL_DT=0.02),
                       "microduck_local.behaviors": SimpleNamespace(BehaviorEnv=environment)}
            with (patch.dict(sys.modules, modules), patch.dict(os.environ, {}),
                  patch.object(bridge, "__file__", str(python / "bridge.py")),
                  patch.object(bridge, "runtime_versions", side_effect=lambda: dict(runtime)),
                  patch.object(bridge, "bam_provenance", return_value={}),
                  patch.object(bridge, "verify_bam"), patch.object(bridge, "frozen_bam", side_effect=lambda value: contextlib.nullcontext()),
                  patch.object(bridge, "validate_spec", side_effect=lambda spec, limits: dict(spec))):
                trainer = {"backend": "rlx", "learnerDevice": "metal", "physicsDevice": "cpu",
                           "helperSha256": {"rlx_ppo.py": bridge.file_hash(python / "rlx_ppo.py")},
                           "recipe": rlx.recipe(SPEC, provider.limits)}
                trainer["sha256"] = bridge.digest(trainer)
                run_id = "run-00000000-0000-0000-0000-000000000000"
                with patch.object(bridge, "trainer_provenance", return_value=trainer):
                    provider.prepare_train(run_id, SPEC)
                    if mutation is None:
                        result = provider.train(run_id)
                        self.assertEqual(result["state"], "completed")
                        self.assertEqual(result["policyId"], "run:" + run_id)
                    else:
                        patterns = {"bridge": "bridge/studio", "studio": "bridge/studio", "helper": "learner/exporter",
                                    "rlx": "RLX source", "local": "Lab source/model", "model": "Lab source/model",
                                    "runtime": "dependency versions"}
                        with self.assertRaisesRegex(ValueError, patterns[mutation]):
                            provider.train(run_id)
                        result = provider.run(run_id)
                        self.assertEqual(result["state"], "failed")
                        self.assertIsNone(result["policyId"])
                        self.assertIsNone(result["policySha256"])
                        self.assertTrue((provider.path(run_id) / "policy.onnx").is_file())
                        with self.assertRaisesRegex(ValueError, "completed run"):
                            provider.inspect_policy("run:" + run_id)
                    self.assertEqual(episode_times, [0.06])

    def test_unchanged_export_completes_with_effective_episode_duration(self):
        self.exercise_completion()

    def test_post_export_source_or_runtime_mutation_prevents_completion(self):
        for mutation in ("rlx", "local", "model", "helper", "bridge", "studio", "runtime"):
            with self.subTest(mutation=mutation):
                self.exercise_completion(mutation)


@unittest.skipUnless(os.environ.get("ROBOT_RLX_NUMERIC") == "1", "requires explicitly selected RLX/Metal numeric runtime")
class NumericExportTests(unittest.TestCase):
    def test_export_uses_actual_float64_statistics_without_changing_rlx_actor(self):
        import numpy as np
        source = rlx.source_root(os.environ["ROBOT_RLX_SOURCE"])
        with patch.object(sys, "path", [str(source), *sys.path]):
            import mlx.core as mx
            import onnx
            import onnxruntime as ort
            from rlx.models.microduck import create_actor_critic, save_checkpoint
            from rlx.export.microduck_onnx import export_deterministic_actor
            mx.random.seed(1)
            model = create_actor_critic()
            mx.eval(model.parameters())
            mean = np.full(61, 100000000.25, np.float64)
            variance = np.full(61, 0.0001, np.float64)
            env = SimpleNamespace(observation_rms=SimpleNamespace(mean=mean, var=variance, count=100),
                                  epsilon=1e-8, clip=10.0)
            observations = [np.full(61, 100000000, np.float32)]
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                checkpoint = root / "rlx.safetensors"
                save_checkpoint(checkpoint, model, mean, variance, 100, epsilon=env.epsilon, clip=env.clip)
                original = root / "original.onnx"
                export_deterministic_actor(checkpoint, original)
                rlx.export_policy(root, checkpoint, model, env, observations)
                evidence = json.loads((root / "export-parity.json").read_text())
                self.assertGreater(evidence["checkpointFloat32MaxAbsoluteError"], 0.01)
                self.assertLess(evidence["maxAbsoluteError"], 1e-5)
                self.assertEqual(evidence["realObservationCount"], 1)
                with np.load(root / "normalizer.npz", allow_pickle=False) as saved:
                    np.testing.assert_array_equal(saved["mean"], mean)
                    self.assertEqual(saved["mean"].dtype, np.float64)
                session = ort.InferenceSession(str(root / "policy.onnx"), providers=["CPUExecutionProvider"])
                self.assertEqual(session.get_inputs()[0].shape, [1, 61])
                self.assertEqual(session.get_outputs()[0].shape, [1, 14])
                before = onnx.load(original)
                after = onnx.load(root / "policy.onnx")
                self.assertEqual(list(before.graph.node)[5:], list(after.graph.node)[5:])
                self.assertEqual([v for v in before.graph.initializer if v.name.startswith("actor_")],
                                 [v for v in after.graph.initializer if v.name.startswith("actor_")])
                anchor = {"rlx-artifacts.json": hashlib.sha256((root / "rlx-artifacts.json").read_bytes()).hexdigest()}
                rlx.verify_artifacts(root, anchor, hashlib.sha256((root / "policy.onnx").read_bytes()).hexdigest())


if __name__ == "__main__":
    unittest.main()
