"""Synthetic host episode accounting; no MLX, MuJoCo or learned-policy execution."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np
import test_rlx_ppo as existing

rlx = existing.rlx


def info(lengths, done, truncated=None):
    """Build the copied NumPy episode arrays published by RLX's vector adapter."""
    return {"episode": {"l": np.asarray(lengths, dtype=np.int64), "r": np.zeros(len(lengths))},
            "_episode": np.asarray(done, dtype=bool),
            "infos": [{"TimeLimit.truncated": flag} for flag in (truncated or [False] * len(lengths))]}


def reference(steps=2, loop=True):
    return {"clipFileSha256": "a" * 64, "clipSteps": steps, "loop": loop}


class EpisodeAccountingTests(unittest.TestCase):
    def test_completed_termination_timeout_and_censored_tails_partition_all_transitions(self):
        report = rlx._TrainingDiagnostics(3, 12, 3, reference())
        trace = [info([1, 1, 1], [False, False, True]),
                 info([2, 2, 1], [True, False, False]),
                 info([1, 3, 2], [False, True, False], [False, True, False]),
                 info([2, 1, 3], [False, False, True], [False, False, True])]
        for index, sample in enumerate(trace):
            before = copy.deepcopy(sample)
            report.on_step(sample, index * 3)
            np.testing.assert_array_equal(sample["episode"]["l"], before["episode"]["l"])
            np.testing.assert_array_equal(sample["_episode"], before["_episode"])
            self.assertEqual(sample["infos"], before["infos"])
            snapshot = report.snapshot()
            completed = sum(value["lengthSum"] for value in snapshot["completedEpisodes"].values())
            self.assertEqual(completed + sum(snapshot["rightCensoredEpisodeLengths"]), (index + 1) * 3)
        self.assertEqual(snapshot["observedTransitions"], 12)
        self.assertTrue(snapshot["collectionComplete"])
        self.assertEqual(snapshot["maxObservedEpisodeAge"], 3)
        self.assertEqual(snapshot["rightCensoredEpisodeLengths"], [2, 1, 0])
        self.assertEqual(snapshot["completedEpisodes"]["terminated"], {"count": 2, "lengthSum": 3,
            "minLength": 1, "maxLength": 2, "histogramCounts": [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]})
        self.assertEqual(snapshot["completedEpisodes"]["truncated"], {"count": 2, "lengthSum": 6,
            "minLength": 3, "maxLength": 3, "histogramCounts": [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]})
        exposure = snapshot["referenceExposure"]
        self.assertEqual(exposure["binCounts"], [4 if index == 0 else 8 if index == 16 else 0 for index in range(32)])
        self.assertEqual(exposure["elapsedReferenceTraversals"], 4)
        self.assertEqual(exposure["semantics"], "source-derived-post-step-reward-reference-index-v1")
        self.assertIsNone(snapshot["referenceExposureUnavailableReason"])

    def test_empty_and_partial_collection_keep_unfinished_episode_lengths_censored(self):
        report = rlx._TrainingDiagnostics(2, 8, 4, None)
        empty = report.snapshot()
        self.assertEqual(empty["rightCensoredEpisodeLengths"], [0, 0])
        self.assertFalse(empty["collectionComplete"])
        self.assertEqual(empty["maxObservedEpisodeAge"], 0)
        for summary in empty["completedEpisodes"].values():
            self.assertEqual((summary["count"], summary["lengthSum"], summary["minLength"], summary["maxLength"]), (0, 0, None, None))
        report.on_step(info([1, 1], [False, False]), 0)
        partial = report.snapshot()
        self.assertEqual(partial["rightCensoredEpisodeLengths"], [1, 1])
        self.assertEqual(partial["observedTransitions"], 2)
        self.assertFalse(partial["collectionComplete"])
        self.assertIsNone(partial["referenceExposure"])
        self.assertEqual(partial["referenceExposureUnavailableReason"],
                         "No explicit owned custom reference was selected; default behavior references were not measured.")
        partial["rightCensoredEpisodeLengths"][0] = 99
        partial["completedEpisodes"]["terminated"]["histogramCounts"][0] = 99
        self.assertEqual(report.snapshot()["rightCensoredEpisodeLengths"], [1, 1])
        self.assertEqual(report.snapshot()["completedEpisodes"]["terminated"]["histogramCounts"][0], 0)

    def test_fixed_length_bins_include_boundaries_and_overflow_without_scaling_with_budget(self):
        lengths = [1, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 1025]
        report = rlx._TrainingDiagnostics(1, sum(lengths), 2048, None)
        collected = 0
        for length in lengths:
            for age in range(1, length + 1):
                report.on_step(info([age], [age == length]), collected)
                collected += 1
        snapshot = report.snapshot()
        self.assertEqual(snapshot["lengthHistogramUpperBoundsSteps"], lengths[:-1] + [None])
        self.assertEqual(snapshot["completedEpisodes"]["terminated"], {"count": 11, "lengthSum": sum(lengths),
            "minLength": 1, "maxLength": 1025, "histogramCounts": [1] * 11})
        self.assertEqual(snapshot["rightCensoredEpisodeLengths"], [0])
        self.assertLess(len(json.dumps(snapshot)), 2000)

    def test_post_step_reference_indices_wrap_or_hold_using_clip_steps_not_episode_limit(self):
        for loop, bins, traversals in ((True, {0: 2, 10: 3, 21: 2}, 2), (False, {10: 1, 21: 6}, 1)):
            with self.subTest(loop=loop):
                report = rlx._TrainingDiagnostics(1, 7, 7, reference(3, loop))
                for prior in range(7):
                    report.on_step(info([prior + 1], [False]), prior)
                snapshot = report.snapshot()
                self.assertEqual(snapshot["rightCensoredEpisodeLengths"], [7])
                exposure = snapshot["referenceExposure"]
                self.assertEqual(exposure["binCounts"], [bins.get(index, 0) for index in range(32)])
                self.assertEqual(exposure["elapsedReferenceTraversals"], traversals)
                self.assertEqual(sum(exposure["binCounts"]), snapshot["observedTransitions"])
                exposure["binCounts"][0] = 100
                self.assertNotEqual(report.snapshot()["referenceExposure"]["binCounts"][0], 100)

    def test_single_sample_reference_counts_indices_without_claiming_success(self):
        for loop, traversals in ((True, 3), (False, 1)):
            with self.subTest(loop=loop):
                report = rlx._TrainingDiagnostics(1, 3, 3, reference(1, loop))
                for prior in range(3):
                    report.on_step(info([prior + 1], [prior == 2]), prior)
                snapshot = report.snapshot()
                self.assertEqual(snapshot["referenceExposure"]["binCounts"], [3] + [0] * 31)
                self.assertEqual(snapshot["referenceExposure"]["elapsedReferenceTraversals"], traversals)
                self.assertEqual(snapshot["completedEpisodes"]["terminated"]["count"], 1)
                self.assertNotIn("passed", snapshot)

    def test_rejects_missing_repeated_or_invalid_ages_before_changing_any_counter(self):
        for lengths in ([0, 1], [1, 2], [1.0, 1], [True, 1], [float("nan"), 1]):
            report = rlx._TrainingDiagnostics(2, 4, 2, None)
            sample = info([1, 1], [False, False])
            sample["episode"]["l"] = lengths
            with self.subTest(lengths=lengths), self.assertRaisesRegex(ValueError, "episode age"):
                report.on_step(sample, 0)
            self.assertEqual(report.snapshot()["observedTransitions"], 0)
        report = rlx._TrainingDiagnostics(2, 4, 2, None)
        report.on_step(info([1, 1], [False, True]), 0)
        before = report.snapshot()
        for sample, prior in ((info([2, 1], [False, False]), 0),
                              (info([2], [False]), 2), (info([2, 2], [False, False]), 2)):
            with self.assertRaisesRegex(ValueError, "training diagnostics"):
                report.on_step(sample, prior)
            self.assertEqual(report.snapshot(), before)

    def test_rejects_timeout_before_episode_limit_and_collection_after_budget(self):
        report = rlx._TrainingDiagnostics(1, 1, 3, None)
        with self.assertRaisesRegex(ValueError, "timeout"):
            report.on_step(info([1], [True], [True]), 0)
        report.on_step(info([1], [True]), 0)
        with self.assertRaisesRegex(ValueError, "collected transitions"):
            report.on_step(info([1], [False]), 1)
        self.assertTrue(report.snapshot()["collectionComplete"])


class OwnedReferenceTests(unittest.TestCase):
    def test_uses_owned_runtime_loader_and_retains_the_exact_clip_file_digest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "clips").mkdir()
            spec = {"duration": 0.14, "loop": True, "keys": [{"t": 0, "joints": [0] * 14}]}
            data = json.dumps(spec).encode()
            (root / "clips/reference.json").write_bytes(data)
            loader = Mock(return_value=SimpleNamespace(steps=7, loop=True))
            with patch.dict(sys.modules, {"microduck_local.motion": SimpleNamespace(load_clip=loader)}):
                self.assertEqual(rlx._training_reference(root, spec), {"clipFileSha256": hashlib.sha256(data).hexdigest(),
                                                                      "clipSteps": 7, "loop": True})
                loader.assert_called_once_with("reference", root / "clips")
                with self.assertRaisesRegex(ValueError, "frozen clip"):
                    rlx._training_reference(root, {**spec, "duration": 0.2})
                loader.assert_called_once()
                self.assertIsNone(rlx._training_reference(root, None))
                loader.assert_called_once()


if __name__ == "__main__":
    unittest.main()
