"""Pure control-grid regressions and isolated pre-training assessment admission."""
import builtins
import copy
import json
import math
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

PYTHON = Path(__file__).parents[1] / "python"
with patch.object(sys, "path", [str(PYTHON), *sys.path]):
    import bridge
    import dance_metrics as dance


CRITERIA = {"version": 1, "requiredCycles": 2, "minPassedEpisodeFraction": 1.0,
            "maxJointRmseRad": [0.01] * 14, "maxRootOrientationRmseRad": 0.01,
            "movingJointIndices": [0], "minReferenceExcursionRad": 0.01,
            "minAmplitudeRatio": 0.8, "maxAmplitudeRatio": 1.2, "minReferenceGainRatio": 0.8,
            "maxHorizontalDriftMeters": 0.1}
EVALUATION = {"episodes": 1, "stepsPerEpisode": 40, "seed": 10, "maxTerminations": 0,
              "minMeanUprightFraction": 0.9, "dance": CRITERIA}
LIMITS = {"maxEvaluationEpisodes": 4, "maxSimulationSteps": 100}


def wave(count=20):
    return [[0.1 * math.sin(2 * math.pi * k / count), *([0.0] * 13)] for k in range(count)]


def clip_record(duration=0.4):
    return {"version": 1, "name": "test", "duration": duration, "loop": True,
            "keys": [{"t": 0.0, "joints": [0.0] * 14, "rootPitch": 0.0},
                     {"t": duration, "joints": [0.0] * 14, "rootPitch": 0.0}]}


def plan_for(joints, evaluation=None, blocks=(), pitch=None):
    evaluation = copy.deepcopy(evaluation or EVALUATION)
    pitch = pitch if pitch is not None else [0.0] * len(joints)
    reference = dance.reference_descriptor(clip_record(), joints, pitch, 0.02,
                                           [f"joint{i}" for i in range(14)], "root", blocks, evaluation, bridge.digest)
    return {"version": evaluation["dance"]["version"], "reference": reference, "evaluation": evaluation}


def samples_for(joints, steps=40, shift=0, pitch=None):
    result = []
    for k in range(1, steps + 1):
        angle = pitch[k % len(pitch)] if pitch is not None else 0.0
        result.append({"step": k, "joints": joints[(k - shift) % len(joints)][:],
                       "rootPosition": [0.0, 0.0, 1.0],
                       "rootQuaternion": [math.cos(angle / 2), 0.0, math.sin(angle / 2), 0.0]})
    return result


class MeasurementTests(unittest.TestCase):
    def setUp(self):
        self.joints = wave()
        self.pitch = [0.0] * 20
        self.plan = plan_for(self.joints, blocks=[(0, 10), (10, 20)])
        self.samples = samples_for(self.joints)

    def assess(self, samples=None, steps=40, terminated=False, truncated=True):
        return dance.episode(self.plan, self.samples if samples is None else samples, self.joints, self.pitch,
                             [0.0, 0.0, 1.0], [1.0, 0.0, 0.0, 0.0], steps, terminated, truncated)

    def test_exact_reference_passes_each_cycle_and_block(self):
        result = self.assess()
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["completedCycles"], 2)
        for cycle in result["cycles"]:
            for interval in [cycle, *cycle["blocks"]]:
                self.assertTrue(interval["complete"])
                self.assertEqual(interval["steps"], interval["measuredSteps"])
                self.assertEqual(interval["jointRmseRad"], [0.0] * 14)
                self.assertAlmostEqual(interval["amplitudeRatio"][0], 1)
                self.assertAlmostEqual(interval["referenceGainRatio"][0], 1)
                self.assertEqual(interval["amplitudeRatio"][1:], [None] * 13)
        self.assertEqual(self.assess(truncated=False)["status"], "passed")

    def test_constant_settling_and_second_cycle_standing_fail_movement(self):
        for kind in ("constant", "settling", "second-cycle"):
            samples = copy.deepcopy(self.samples)
            for row in samples:
                if kind == "constant" or (kind == "second-cycle" and row["step"] > 20):
                    row["joints"][0] = 0.0
                elif kind == "settling":
                    row["joints"][0] = 0.3 * math.exp(-row["step"])
            with self.subTest(kind=kind):
                result = self.assess(samples)
                self.assertEqual(result["status"], "failed")
                self.assertIn("reference-gain", result["reasons"])
                self.assertIn("amplitude-ratio", result["cycles"][1]["reasons"])

    def test_phase_shift_and_wrong_joint_do_not_gain_from_unaligned_amplitude(self):
        shifted = self.assess(samples_for(self.joints, shift=5))
        self.assertEqual(shifted["status"], "failed")
        self.assertAlmostEqual(shifted["cycles"][0]["amplitudeRatio"][0], 1)
        self.assertIn("reference-gain", shifted["reasons"])
        wrong = copy.deepcopy(self.samples)
        for row in wrong:
            row["joints"][1], row["joints"][0] = row["joints"][0], 0.0
        self.assertIn("joint-rmse", self.assess(wrong)["reasons"])

    def test_inactive_blocks_keep_tracking_without_invented_movement(self):
        self.joints = [[row[0] if 1 <= k <= 10 else 0.0, *row[1:]] for k, row in enumerate(self.joints)]
        self.plan = plan_for(self.joints, blocks=[(0, 10), (10, 20)])
        self.samples = samples_for(self.joints)
        self.assertEqual(self.plan["reference"]["blocks"][1]["activeJointIndices"], [])
        result = self.assess()
        self.assertEqual(result["status"], "passed")
        block = result["cycles"][0]["blocks"][1]
        self.assertEqual(block["amplitudeRatio"], [None] * 14)
        self.assertEqual(block["jointRmseRad"], [0.0] * 14)

    def test_block_failure_cannot_hide_in_cycle_average(self):
        self.plan["evaluation"]["dance"]["maxJointRmseRad"][0] = 0.03
        samples = copy.deepcopy(self.samples)
        for row in samples:
            if 1 <= row["step"] <= 10:
                row["joints"][0] += 0.04
        cycle = self.assess(samples)["cycles"][0]
        self.assertLess(cycle["jointRmseRad"][0], 0.03)
        self.assertEqual(cycle["status"], "failed")
        self.assertIn("joint-rmse", cycle["reasons"])

    def test_root_pitch_sign_and_initial_heading_are_measured(self):
        self.pitch = [-0.2] * 20
        self.plan = plan_for(self.joints, pitch=self.pitch)
        self.samples = samples_for(self.joints, pitch=[0.2] * 20)
        self.assertIn("root-rmse", self.assess()["reasons"])
        yaw = 0.7
        qyaw = [math.cos(yaw / 2), 0, 0, math.sin(yaw / 2)]
        self.assertAlmostEqual(dance.heading(qyaw), yaw)
        self.assertAlmostEqual(dance.root_error(qyaw, 0, yaw), 0)
        self.assertAlmostEqual(dance.root_error([-v for v in qyaw], 0, yaw), 0)

    def test_out_and_back_drift_is_not_hidden_by_endpoint(self):
        self.samples[10]["rootPosition"][0] = 0.2
        result = self.assess()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["cycles"][0]["maxHorizontalDriftMeters"], 0.2)
        self.assertIn("horizontal-drift", result["reasons"])

    def test_terminal_boundary_is_not_a_completed_qualifying_cycle(self):
        result = self.assess(self.samples[:20], steps=20, terminated=True, truncated=True)
        self.assertEqual(result["completedCycles"], 1)
        self.assertFalse(result["cycles"][0]["complete"])
        self.assertEqual(result["status"], "failed")
        self.assertIn("terminated", result["reasons"])
        self.assertIn("early-truncated", result["reasons"])
        self.assertEqual(self.assess(self.samples[:15], steps=15)["status"], "failed")
        with self.assertRaisesRegex(ValueError, "terminal or truncation"):
            self.assess(self.samples[:15], steps=15, truncated=False)

    def test_missing_samples_are_incomplete_and_known_violations_still_fail(self):
        missing = self.samples[:9] + self.samples[10:]
        result = self.assess(missing)
        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(result["cycles"][0]["steps"], 20)
        self.assertEqual(result["cycles"][0]["measuredSteps"], 19)
        self.assertFalse(result["cycles"][0]["complete"])
        missing[0]["rootPosition"][0] = 0.2
        self.assertEqual(self.assess(missing)["status"], "failed")

    def test_common_finite_mask_and_empty_measurements_are_explicit(self):
        self.samples[3]["rootQuaternion"] = [float("nan"), 0, 0, 0]
        result = self.assess()
        self.assertEqual(result["cycles"][0]["measuredSteps"], 19)
        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(result["cycles"][0]["jointRmseRad"], [0.0] * 14)
        for row in self.samples:
            row["rootQuaternion"] = None
        empty = self.assess()["cycles"][0]
        self.assertEqual(empty["measuredSteps"], 0)
        self.assertIsNone(empty["rootOrientationRmseRad"])
        self.assertIsNone(empty["jointRmseRad"])
        self.assertEqual(empty["amplitudeRatio"], [None] * 14)
        self.assertEqual(empty["status"], "incomplete")
        json.dumps(self.assess(), allow_nan=False)

    def test_extra_cycles_are_coverage_not_extra_required_windows(self):
        self.plan["evaluation"]["stepsPerEpisode"] = 60
        result = self.assess(samples_for(self.joints, steps=60), steps=60)
        self.assertEqual(result["completedCycles"], 3)
        self.assertEqual(len(result["cycles"]), 2)
        later = self.assess(samples_for(self.joints, steps=50), steps=50, terminated=True)
        self.assertTrue(all(c["complete"] for c in later["cycles"]))
        self.assertEqual(later["status"], "failed")

    def test_safe_aggregate_bounds_preserve_incomplete_uncertainty(self):
        criterion = {**CRITERIA, "minPassedEpisodeFraction": 0.5}
        self.assertEqual(dance.evaluation_status([{"status": "passed"}, {"status": "incomplete"}], criterion), "passed")
        self.assertEqual(dance.evaluation_status([{"status": "failed"}, {"status": "incomplete"}], criterion), "incomplete")
        self.assertEqual(dance.evaluation_status([{"status": "failed"}, {"status": "failed"}], criterion), "failed")
        self.assertEqual(dance.evaluation_status([], criterion), "incomplete")

    def test_non_grid_clock_and_invalid_reference_admission(self):
        raw = clip_record(0.405)
        result = dance.reference_descriptor(raw, self.joints, self.pitch, 0.02,
                                            [f"joint{i}" for i in range(14)], "root", [], EVALUATION, bridge.digest)
        self.assertEqual(result["authoredDurationSeconds"], 0.405)
        self.assertEqual(result["cycleSeconds"], 0.4)
        for raw_override, evaluation, joints in (
                ({**raw, "loop": False}, EVALUATION, self.joints),
                (raw, {**EVALUATION, "stepsPerEpisode": 39}, self.joints),
                (raw, EVALUATION, [[0.0] * 14] * 20)):
            with self.assertRaises(ValueError):
                dance.reference_descriptor(raw_override, joints, self.pitch, 0.02,
                                           [f"joint{i}" for i in range(14)], "root", [], evaluation, bridge.digest)

    def test_nonloop_requires_exact_single_execution_horizon(self):
        raw = {**clip_record(), "loop": False}
        evaluation = {**EVALUATION, "stepsPerEpisode": 20, "dance": {**CRITERIA, "requiredCycles": 1}}
        reference = dance.reference_descriptor(raw, self.joints, self.pitch, 0.02,
                                              [f"joint{i}" for i in range(14)], "root", [], evaluation, bridge.digest)
        self.assertFalse(reference["loop"])
        for steps in (19, 21, 40):
            with self.subTest(steps=steps), self.assertRaises(ValueError):
                dance.reference_descriptor(raw, self.joints, self.pitch, 0.02,
                                           [f"joint{i}" for i in range(14)], "root", [],
                                           {**evaluation, "stepsPerEpisode": steps}, bridge.digest)

    def test_criteria_require_explicit_fields_and_finite_bounds(self):
        self.assertEqual(dance.validate_evaluation(EVALUATION, LIMITS), EVALUATION)
        for field in CRITERIA:
            value = copy.deepcopy(EVALUATION)
            del value["dance"][field]
            with self.subTest(field=field), self.assertRaises(ValueError):
                dance.validate_evaluation(value, LIMITS)
        for field, bad in (("minAmplitudeRatio", 0), ("maxRootOrientationRmseRad", float("nan")),
                           ("movingJointIndices", [0, 0]), ("requiredCycles", True)):
            with self.subTest(field=field), self.assertRaises(ValueError):
                dance.validate_evaluation({**EVALUATION, "dance": {**CRITERIA, field: bad}}, LIMITS)


class Values(list):
    def tolist(self):
        return copy.deepcopy(list(self))


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.lab, self.python = self.root / "lab", self.root / "python"
        self.files = [self.python / name for name in ("bridge.py", "studio.py", "dance_metrics.py")]
        self.files += [self.lab / "microduck_local/src/fixture.py", self.lab / "microduck_rl/src/mjlab_microduck/robot/model.xml"]
        for path in self.files:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("# isolated source\n")
        self.provider = object.__new__(bridge.Bridge)
        self.provider.source, self.provider.root = self.lab, self.root / "storage"
        self.provider.limits = {**LIMITS, "snapshotSteps": 2}
        self.joints, self.pitch = wave(), [0.0] * 20
        self.runtime = {}
        self.control = SimpleNamespace(CTRL_DT=0.02, JOINT_NAMES=tuple(f"joint{i}" for i in range(14)))
        self.motion = SimpleNamespace(CONTROL_HZ=50.0, load_clip=lambda *args: SimpleNamespace(
            joints=Values(self.joints), pitch=Values(self.pitch), steps=len(self.joints)))
        self.profile = {"joints": [{"name": name} for name in self.control.JOINT_NAMES], "rootBody": {"name": "root", "index": 1}}
        self.studio = SimpleNamespace(profile=lambda: copy.deepcopy(self.profile), validate_clip_targets=lambda *args: None)
        trainer = {"backend": "cpu", "learnerDevice": "cpu", "physicsDevice": "cpu", "helperSha256": {}, "recipe": {}}
        trainer["sha256"] = bridge.digest(trainer)
        patches = [patch.object(bridge, "__file__", str(self.python / "bridge.py")),
                   patch.object(bridge, "validate_spec", side_effect=lambda spec, limits: copy.deepcopy(spec)),
                   patch.object(bridge, "trainer_provenance", return_value=trainer),
                   patch.object(bridge, "runtime_versions", side_effect=lambda: dict(self.runtime)),
                   patch.object(bridge, "bam_provenance", return_value={}), patch.object(bridge, "verify_bam"),
                   patch.object(self.provider, "studio", return_value=self.studio), patch.dict(os.environ, {}),
                   patch.dict(sys.modules, {"microduck_local": SimpleNamespace(contract=self.control),
                                            "microduck_local.contract": self.control, "microduck_local.motion": self.motion})]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.spec = {"name": "test", "backend": "cpu", "behaviorId": "imitate", "steps": 1, "envs": 1,
                     "seed": 1, "actuator": "bam", "weights": {}, "clip": clip_record(0.405)}
        self.run_id = "run-00000000-0000-0000-0000-000000000000"

    def prepare(self, evaluation=None):
        return self.provider.prepare_train(self.run_id, self.spec, copy.deepcopy(evaluation or EVALUATION))

    def test_resolved_plan_is_durable_before_training_and_reloads(self):
        run = self.prepare()
        self.assertEqual(run["state"], "starting")
        self.assertIsNone(run["policyId"])
        plan = run["dancePlan"]
        self.assertEqual(plan["evaluation"], EVALUATION)
        self.assertEqual(plan["evaluatorSha256"], bridge.bridge_hash())
        self.assertEqual(plan["reference"]["cycleSeconds"], 0.4)
        self.assertEqual(plan["reference"]["authoredDurationSeconds"], 0.405)
        self.assertEqual(self.provider.run(self.run_id)["dancePlan"], plan)
        self.provider.configure_run(run, training=True)
        self.assertEqual(plan["sha256"], bridge.digest({k: v for k, v in plan.items() if k != "sha256"}))

    def test_admission_preserves_explicit_v1_and_v2_without_upgrade(self):
        for version in (1, 2):
            with self.subTest(version=version):
                self.run_id = f"run-00000000-0000-0000-0000-{version:012d}"
                evaluation = {**EVALUATION, "dance": {**CRITERIA, "version": version}}
                run = self.prepare(evaluation)
                self.assertEqual(run["dancePlan"]["version"], version)
                self.assertEqual(run["dancePlan"]["evaluation"], evaluation)
                self.assertEqual(self.provider.run(self.run_id)["dancePlan"], run["dancePlan"])
                self.provider.configure_run(run, training=True)
                altered = copy.deepcopy(run)
                altered["dancePlan"]["version"] = 3 - version
                altered["dancePlan"]["sha256"] = bridge.digest({
                    key: value for key, value in altered["dancePlan"].items() if key != "sha256"})
                with self.assertRaisesRegex(ValueError, "matching version"):
                    self.provider.validate_dance_plan(altered, recompute=False)

    def test_unsupported_criteria_version_rejects_before_run_allocation(self):
        for version in (0, 3, True, 2.0, "2", None):
            with self.subTest(version=version), self.assertRaises(ValueError):
                self.prepare({**EVALUATION, "dance": {**CRITERIA, "version": version}})
        self.assertFalse(self.provider.path(self.run_id).exists())

    def test_inactive_or_short_assessment_never_publishes_manifest(self):
        self.joints = [[0.0] * 14 for _ in range(20)]
        with self.assertRaisesRegex(ValueError, "inactive"):
            self.prepare()
        self.assertFalse((self.provider.path(self.run_id) / "manifest.json").exists())

    def test_short_horizon_rejects_before_admission_commit(self):
        with self.assertRaisesRegex(ValueError, "horizon"):
            self.prepare({**EVALUATION, "stepsPerEpisode": 39})
        self.assertFalse((self.provider.path(self.run_id) / "manifest.json").exists())

    def test_plan_science_excludes_training_seed_but_includes_evaluation_seed(self):
        first = self.prepare()["dancePlan"]
        self.run_id = "run-00000000-0000-0000-0000-000000000001"
        self.spec["seed"] = 99
        second = self.prepare()["dancePlan"]
        self.assertEqual(first["sha256"], second["sha256"])
        self.run_id = "run-00000000-0000-0000-0000-000000000002"
        third = self.prepare({**EVALUATION, "seed": 11})["dancePlan"]
        self.assertNotEqual(first["sha256"], third["sha256"])

    def test_raw_clip_mutation_rejects_before_training_starts(self):
        self.prepare()
        path = self.provider.path(self.run_id) / "clips/reference.json"
        altered = copy.deepcopy(self.spec["clip"])
        altered["keys"][0]["joints"][0] = 0.2
        bridge.write_json(path, altered)
        with self.assertRaisesRegex(ValueError, "frozen clip"):
            self.provider.train(self.run_id)
        self.assertEqual(self.provider.run(self.run_id)["state"], "starting")

    def test_post_export_grid_mutation_prevents_cpu_completion(self):
        self.prepare()
        def training():
            (self.provider.path(self.run_id) / "policy.onnx").write_bytes(b"unpublished test output")
            self.joints[0][0] += 0.02
        trainer = SimpleNamespace(main=training)
        with (patch.object(sys.modules["microduck_local"], "train_behavior", trainer, create=True),
              patch.dict(sys.modules, {"microduck_local.behaviors": SimpleNamespace(BehaviorEnv=lambda *a, **k: None)}),
              patch.object(sys, "argv", list(sys.argv))):
            with self.assertRaisesRegex(ValueError, "dance science"):
                self.provider.train(self.run_id)
        result = self.provider.run(self.run_id)
        self.assertEqual(result["state"], "failed")
        self.assertIsNone(result["policyId"])
        self.assertIsNone(result["policySha256"])

    def test_plan_metadata_mutation_rejects_reload(self):
        run = self.prepare()
        run["dancePlan"]["evaluation"]["seed"] += 1
        bridge.write_json(self.provider.path(self.run_id) / "manifest.json", run)
        with self.assertRaisesRegex(ValueError, "plan hash"):
            self.provider.run(self.run_id)

    def test_sampled_reference_mutation_rejects_runtime_reload(self):
        run = self.prepare()
        self.joints[3][0] += 0.01
        with self.assertRaisesRegex(ValueError, "dance science"):
            self.provider.configure_run(run)
        self.assertEqual(self.provider.run(self.run_id)["state"], "starting")

    def test_training_preflight_checks_identities_without_numeric_plan_resolution(self):
        run = self.prepare()
        imported = builtins.__import__
        def guarded_import(name, *args, **kwargs):
            if name.split(".")[0] in ("numpy", "mujoco", "torch", "mlx", "microduck_local"):
                raise AssertionError("numeric import before fork: " + name)
            return imported(name, *args, **kwargs)
        with (patch.object(self.provider, "resolve_dance_plan", side_effect=AssertionError("numeric resolver before fork")),
              patch.object(builtins, "__import__", side_effect=guarded_import)):
            self.provider.configure_run(run, training=True)
        self.files[3].write_text("# changed simulator source\n")
        with self.assertRaisesRegex(ValueError, "source/model"):
            self.provider.train(self.run_id)
        self.assertEqual(self.provider.run(self.run_id)["state"], "starting")

    def test_evaluator_and_runtime_mutation_reject_configuration(self):
        run = self.prepare()
        self.files[2].write_text("# changed evaluator\n")
        with self.assertRaisesRegex(ValueError, "bundle"):
            self.provider.configure_run(run)
        self.files[2].write_text("# isolated source\n")
        self.runtime["numpy"] = "changed"
        with self.assertRaisesRegex(ValueError, "dependency versions"):
            self.provider.configure_run(run)

    def test_rehashed_false_reference_does_not_match_actual_simulator(self):
        run = self.prepare()
        plan = run["dancePlan"]
        plan["reference"]["sampledSha256"] = "0" * 64
        plan["sha256"] = bridge.digest({k: v for k, v in plan.items() if k != "sha256"})
        with self.assertRaisesRegex(ValueError, "dance science"):
            self.provider.configure_run(run)

    def test_legacy_admission_contains_no_dance_fields(self):
        run = self.provider.prepare_train(self.run_id, self.spec)
        self.assertNotIn("dancePlan", run)

    def test_evaluation_requires_matching_pretraining_plan_before_rollout(self):
        run = self.prepare()
        policy = {"id": "run:" + self.run_id, "sha256": "1" * 64, "observationProfile": bridge.PHASE}
        loaded = (None, run, b"policy", policy["sha256"])
        with (patch.object(self.provider, "load_policy", return_value=loaded),
              patch.object(self.provider, "policy", return_value=policy),
              patch.object(self.provider, "rollout") as rollout):
            with self.assertRaisesRegex(ValueError, "pre-training criteria"):
                self.provider.evaluate({**EVALUATION, "policyId": policy["id"], "seed": 11})
            del run["dancePlan"]
            with self.assertRaisesRegex(ValueError, "pre-training plan"):
                self.provider.evaluate({**EVALUATION, "policyId": policy["id"]})
            rollout.assert_not_called()
        self.assertFalse((self.provider.root / "evaluations").exists())

    def test_post_rollout_evaluator_mutation_leaves_only_incomplete_admission(self):
        run = self.prepare()
        policy = {"id": "run:" + self.run_id, "sha256": "1" * 64, "observationProfile": bridge.PHASE}
        def rollout(*args, **kwargs):
            self.files[2].write_text("# evaluator changed during assessment\n")
            return {"terminated": False, "uprightFraction": 1.0}, []
        with (patch.object(self.provider, "load_policy", return_value=(None, run, b"policy", policy["sha256"])),
              patch.object(self.provider, "policy", return_value=policy),
              patch.object(self.provider, "rollout", side_effect=rollout)):
            with self.assertRaisesRegex(ValueError, "bundle"):
                self.provider.evaluate({**EVALUATION, "policyId": policy["id"]})
        paths = list((self.provider.root / "evaluations").iterdir())
        self.assertEqual(len(paths), 1)
        self.assertTrue((paths[0] / "request.json").is_file())
        self.assertFalse((paths[0] / "report.json").exists())

    def test_dance_failure_preserves_legacy_upright_pass(self):
        run = self.prepare()
        policy = {"id": "run:" + self.run_id, "sha256": "1" * 64, "observationProfile": bridge.PHASE}
        trace = samples_for([[0.0] * 14 for _ in range(20)])
        metrics = dance.episode(run["dancePlan"], trace, self.joints, self.pitch, [0, 0, 1], [1, 0, 0, 0], 40, False, True)
        result = {"seed": 10, "steps": 40, "terminated": False, "reward": 0.0, "uprightFraction": 1.0,
                  "poseRmse": 0.01, "bamSettings": {}, "dance": metrics}
        with (patch.object(self.provider, "load_policy", return_value=(None, run, b"policy", policy["sha256"])),
              patch.object(self.provider, "policy", return_value=policy),
              patch.object(self.provider, "rollout", return_value=(result, []))):
            report = self.provider.evaluate({**EVALUATION, "policyId": policy["id"]})
        self.assertTrue(report["passed"])
        self.assertEqual(report["danceStatus"], "failed")
        self.assertEqual(report["dancePlan"], run["dancePlan"])
        self.assertEqual(json.loads((self.provider.root / "evaluations" / report["id"] / "request.json").read_text())["dancePlan"], run["dancePlan"])


if __name__ == "__main__":
    unittest.main()
