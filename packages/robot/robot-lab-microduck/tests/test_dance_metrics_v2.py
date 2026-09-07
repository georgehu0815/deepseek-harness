"""Versioned incomplete-window verdicts without changing recorded measurements."""
import copy
import math
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

with patch.object(sys, "path", [str(Path(__file__).parents[1] / "python"), *sys.path]):
    import bridge
    import dance_metrics as dance


def fixture(version=2, count=100, blocks=()):
    joints = [[0.1 * math.sin(2 * math.pi * k / count), *([0.0] * 13)] for k in range(count)]
    criteria = {"version": version, "requiredCycles": 1, "minPassedEpisodeFraction": 1.0,
                "maxJointRmseRad": [0.2] * 14, "maxRootOrientationRmseRad": 0.2,
                "movingJointIndices": [0], "minReferenceExcursionRad": 0.01,
                "minAmplitudeRatio": 0.8, "maxAmplitudeRatio": 1.2,
                "minReferenceGainRatio": 0.8, "maxHorizontalDriftMeters": 0.2}
    evaluation = {"episodes": 1, "stepsPerEpisode": count, "seed": 0, "maxTerminations": 0,
                  "minMeanUprightFraction": 1.0, "dance": criteria}
    dance.validate_evaluation(evaluation, {"maxEvaluationEpisodes": 1, "maxSimulationSteps": count})
    raw = {"version": 1, "name": "synthetic-versioned-metrics", "duration": count * 0.02, "loop": True,
           "keys": [{"t": 0.0, "joints": joints[0][:], "rootPitch": 0.0},
                    {"t": count * 0.02, "joints": joints[0][:], "rootPitch": 0.0}]}
    reference = dance.reference_descriptor(raw, joints, [0.0] * count, 0.02,
        [f"joint-{index}" for index in range(14)], "root", blocks, evaluation, bridge.digest)
    plan = {"version": version, "reference": reference, "evaluation": evaluation}
    rows = [{"step": step, "joints": joints[step % count][:], "rootPosition": [0.0, 0.0, 1.0],
             "rootQuaternion": [1.0, 0.0, 0.0, 0.0]} for step in range(1, count + 1)]
    return plan, joints, rows


def assess(plan, joints, rows, steps=None, terminated=False, truncated=False):
    return dance.episode(plan, rows, joints, [0.0] * len(joints), [0.0, 0.0, 1.0], [1.0, 0.0, 0.0, 0.0],
        len(joints) if steps is None else steps, terminated, truncated)


def mask(rows, observed):
    result = copy.deepcopy(rows)
    for row in result:
        if row["step"] not in observed:
            row["joints"] = None
    return result


def observations_only(value):
    if isinstance(value, list):
        return [observations_only(item) for item in value]
    if isinstance(value, dict):
        return {key: observations_only(item) for key, item in value.items() if key not in ("status", "reasons")}
    return value


class VersionedWindowTests(unittest.TestCase):
    def test_seven_audit_pairs_preserve_v1_and_record_identical_observations(self):
        for name, observed, full_status in (
            ("joint", [1], "passed"), ("root", [1], "passed"),
            ("amplitude-upper", [25, 75], "passed"), ("amplitude-lower", [25, 75], "passed"),
            ("gain", [25, 75], "passed"), ("drift", [1], "failed"),
            ("definite-rmse", list(range(1, 51)), "failed"),
        ):
            with self.subTest(case=name):
                plan, joints, filled = fixture()
                if name == "joint":
                    filled[0]["joints"][0] += 0.3
                elif name == "root":
                    filled[0]["rootQuaternion"] = [math.cos(0.15), 0.0, math.sin(0.15), 0.0]
                elif name == "amplitude-upper":
                    for step in observed:
                        filled[step - 1]["joints"][0] *= 1.5
                elif name == "amplitude-lower":
                    for step in observed:
                        filled[step - 1]["joints"][0] = 0.0
                elif name == "gain":
                    for step in observed:
                        filled[step - 1]["joints"][0] *= -1.0
                elif name == "drift":
                    filled[0]["rootPosition"][0] = 0.3
                else:
                    for row in filled[:50]:
                        row["joints"][1] = 0.3
                partial = mask(filled, observed)
                old_plan = copy.deepcopy(plan)
                old_plan["version"] = old_plan["evaluation"]["dance"]["version"] = 1
                v1 = assess(old_plan, joints, partial)
                v2 = assess(plan, joints, partial)
                complete_v2 = assess(plan, joints, filled)
                self.assertEqual(v1["status"], "failed")
                self.assertEqual(v2["status"], "failed" if full_status == "failed" else "incomplete")
                self.assertEqual(complete_v2["status"], full_status)
                self.assertEqual(observations_only(v1), observations_only(v2))
                self.assertEqual(assess(old_plan, joints, filled), complete_v2)
                self.assertEqual(dance.evaluation_status([v2], plan["evaluation"]["dance"]), v2["status"])
                self.assertEqual(v2["cycles"][0]["measuredSteps"], len(observed))
                if name == "joint":
                    self.assertAlmostEqual(v2["cycles"][0]["jointRmseRad"][0], 0.3)
                    self.assertAlmostEqual(complete_v2["cycles"][0]["jointRmseRad"][0], 0.03)

    def test_exact_rmse_boundary_does_not_fail_and_next_float_does(self):
        plan, joints, rows = fixture(count=4)
        plan["evaluation"]["dance"]["maxJointRmseRad"][1] = 0.5
        rows[0]["joints"][1] = 1.0
        partial = mask(rows, [1])
        at_bound = assess(plan, joints, partial)
        self.assertEqual(at_bound["cycles"][0]["jointRmseRad"][1], 1.0)
        self.assertNotIn("joint-rmse", at_bound["reasons"])
        self.assertEqual(at_bound["status"], "incomplete")
        partial[0]["joints"][1] = math.nextafter(1.0, math.inf)
        over_bound = assess(plan, joints, partial)
        self.assertIn("joint-rmse", over_bound["reasons"])
        self.assertEqual(over_bound["status"], "failed")

    def test_cycle_and_blocks_use_their_own_planned_denominator(self):
        plan, joints, rows = fixture(count=100, blocks=[(0, 25), (25, 100)])
        rows[0]["joints"][1] = 1.5
        value = assess(plan, joints, mask(rows, [1]))
        cycle = value["cycles"][0]
        self.assertEqual(cycle["jointRmseRad"][1], 1.5)
        self.assertEqual(cycle["blocks"][0]["status"], "failed")
        self.assertEqual(cycle["blocks"][1]["status"], "incomplete")
        self.assertEqual(cycle["status"], "failed")
        single_plan, _, _ = fixture()
        self.assertEqual(assess(single_plan, joints, mask(rows, [1]))["status"], "incomplete")

    def test_zero_partial_and_full_coverage_never_impute_measurements(self):
        plan, joints, rows = fixture()
        for observed, expected in (([], "incomplete"), ([1], "incomplete"), (list(range(1, 101)), "passed")):
            with self.subTest(measured=len(observed)):
                value = assess(plan, joints, mask(rows, observed))
                window = value["cycles"][0]
                self.assertEqual(value["status"], expected)
                self.assertEqual(window["measuredSteps"], len(observed))
                self.assertEqual(window["complete"], len(observed) == 100)
                if not observed:
                    self.assertIsNone(window["jointRmseRad"])
                    self.assertIsNone(window["rootOrientationRmseRad"])
                    self.assertEqual(window["amplitudeRatio"], [None] * 14)

    def test_full_finite_termination_still_checks_movement_despite_incomplete_flag(self):
        plan, joints, rows = fixture()
        for row in rows:
            row["joints"][0] = 0.0
        for terminated in (False, True):
            with self.subTest(terminated=terminated):
                value = assess(plan, joints, rows, terminated=terminated)
                window = value["cycles"][0]
                self.assertEqual(window["measuredSteps"], 100)
                self.assertEqual(window["complete"], not terminated)
                self.assertIn("amplitude-ratio", window["reasons"])
                self.assertIn("reference-gain", window["reasons"])
                self.assertEqual(value["status"], "failed")

    def test_termination_and_early_truncation_dominate_missing_measurements(self):
        plan, joints, rows = fixture()
        for terminated, truncated, reason in ((True, False, "terminated"), (False, True, "early-truncated")):
            with self.subTest(reason=reason):
                value = assess(plan, joints, [], steps=1, terminated=terminated, truncated=truncated)
                self.assertEqual(value["status"], "failed")
                self.assertIn(reason, value["reasons"])
        self.assertEqual(assess(plan, joints, rows, truncated=True)["status"], "passed")

    def test_failure_comparison_does_not_square_large_finite_recorded_rmse(self):
        plan, joints, rows = fixture(count=4)
        # Isolate comparison of an already-computed finite statistic, not RMS accumulation.
        original_rms = dance._rms
        for threshold, status in ((0.75e308, "incomplete"), (0.5e308, "incomplete"), (0.25e308, "failed")):
            with self.subTest(threshold=threshold):
                plan["evaluation"]["dance"]["maxJointRmseRad"] = [threshold] * 14
                plan["evaluation"]["dance"]["maxRootOrientationRmseRad"] = threshold
                with patch.object(dance, "_rms", return_value=1e308):
                    value = assess(plan, joints, mask(rows, [1]))
                self.assertIs(dance._rms, original_rms)
                self.assertEqual(value["status"], status)
                self.assertEqual(value["cycles"][0]["jointRmseRad"], [1e308] * 14)
                self.assertEqual(value["cycles"][0]["rootOrientationRmseRad"], 1e308)

    def test_versions_are_explicit_supported_and_coupled_before_hash_validation(self):
        for version in (1, 2):
            plan, joints, rows = fixture(version)
            plan["sha256"] = bridge.digest(plan)
            dance.validate_plan_hash(plan, bridge.digest)
            self.assertEqual(assess(plan, joints, rows)["status"], "passed")
            for other in (1, 2, 3, 0, True, 2.0, "2", None):
                if type(other) is int and other == version:
                    continue
                for field in ("plan", "criteria"):
                    with self.subTest(version=version, other=other, field=field):
                        invalid = copy.deepcopy(plan)
                        if field == "plan":
                            invalid["version"] = other
                        else:
                            invalid["evaluation"]["dance"]["version"] = other
                        invalid["sha256"] = bridge.digest({key: value for key, value in invalid.items() if key != "sha256"})
                        with self.assertRaises(ValueError):
                            dance.validate_plan_hash(invalid, bridge.digest)
                        with self.assertRaises(ValueError):
                            assess(invalid, joints, rows)
        for invalid_version in (0, 3, True, 2.0, "2", None):
            with self.subTest(invalid_version=invalid_version), self.assertRaises(ValueError):
                fixture(invalid_version)


if __name__ == "__main__":
    unittest.main()
