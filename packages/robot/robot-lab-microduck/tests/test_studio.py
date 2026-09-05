"""Studio file boundaries plus opt-in real CPU MuJoCo reference and telemetry proofs."""
import copy
import json
import math
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "python"))
import bridge
from studio import Studio, TEMPLATES, identity, model_layout, strict_json, telemetry

LIMITS = {"maxClipSeconds": 120, "maxClipKeys": 512, "maxSimulationSteps": 1500, "maxEvaluationEpisodes": 2,
          "maxTrainingSteps": 1000, "maxEnvs": 2, "maxRewardWeight": 100, "snapshotSteps": 64,
          "minStudioBpm": 40, "maxStudioBpm": 200, "studioBeatChoices": [16, 32], "maxProjects": 100,
          "studioBlockBeatChoices": [4, 8, 16, 32], "maxProjectBlocks": 8}
JOINTS = ["left_hip_yaw", "left_hip_roll", "left_hip_pitch", "left_knee", "left_ankle",
          "neck_pitch", "head_pitch", "head_yaw", "head_roll", "right_hip_yaw", "right_hip_roll",
          "right_hip_pitch", "right_knee", "right_ankle"]


def recipe(template="head-bob"):
    return {"projectId": None, "name": " 我的鸭鸭 / ディスコ 🦆💃 ", "profileId": "microduck", "templateId": template,
            "templateVersion": 1, "parameters": {"bpm": 96, "beats": 32, "moveSize": 0.5},
            "music": {"version": 1, "style": "disco", "bpm": 96, "beats": 32, "seed": 17}}


def sequence(*template_ids):
    authored = recipe(template_ids[0])
    authored["blocks"] = [{"templateId": key, "templateVersion": 1, "beats": 8, "moveSize": 0.5} for key in template_ids]
    authored["parameters"].update(beats=8 * len(template_ids), moveSize=1)
    authored["music"]["beats"] = authored["parameters"]["beats"]
    return authored


def profile():
    return {"id": "microduck", "label": "MicroDuck", "modelSha256": "0" * 64,
            "rootBody": {"name": "trunk_base", "index": 1}, "hardwareAvailable": False,
            "joints": [{"name": name, "index": i + 1, "lower": -0.2, "upper": 0.2,
                        "defaultPosition": 0.0, "unit": "rad"} for i, name in enumerate(JOINTS)]}


class StudioBoundaryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.provider = object.__new__(bridge.Bridge)
        self.provider.root = Path(temporary.name).resolve()
        self.provider.limits = dict(LIMITS)
        self.studio = Studio(self.provider)
        mock = patch.object(self.studio, "profile", side_effect=profile)
        mock.start()
        self.addCleanup(mock.stop)

    def test_catalog_lists_experimental_templates_and_configured_limits(self):
        catalog = self.studio.catalog()
        self.assertEqual(catalog["profiles"][0]["id"], "microduck")
        self.assertEqual({t["id"] for t in catalog["templates"]}, {t[0] for t in TEMPLATES})
        self.assertTrue(all(t["experimental"] for t in catalog["templates"]))
        self.assertEqual([(t["id"], t["label"]) for t in catalog["templates"] if t["category"] == "action"],
                         [("stand", "Stand Steady"), ("hello", "Say Hello"), ("look-around", "Look Around")])
        self.assertTrue(all(t["defaultParameters"] == {"bpm": 96, "beats": 32, "moveSize": 0.5}
                            for t in catalog["templates"]))
        self.assertEqual(catalog["limits"]["maxClipKeys"], 512)
        self.provider.limits.update(minStudioBpm=110, maxStudioBpm=130, studioBeatChoices=[16])
        configured = Studio(self.provider)
        self.assertEqual(configured.templates()[0]["defaultParameters"], {"bpm": 110, "beats": 16, "moveSize": 0.5})
        with self.assertRaisesRegex(ValueError, "BPM"):
            configured.validate_recipe(recipe())

    def test_curated_weights_are_frozen_and_catalog_callers_cannot_mutate_defaults(self):
        template = self.studio.templates()[0]
        self.assertEqual(template["trainingWeights"], {"travel": 0})
        template["trainingWeights"]["travel"] = 5
        self.assertEqual(self.studio.templates()[0]["trainingWeights"], {"travel": 0})
        saved = self.studio.save(recipe())
        self.assertEqual(saved["template"]["trainingWeights"], {"travel": 0})
        for weight in (True, -1, 5):
            modified = copy.deepcopy(saved)
            modified["template"]["trainingWeights"]["travel"] = weight
            modified["sha256"] = bridge.digest({key: value for key, value in modified.items() if key != "sha256"})
            with self.subTest(weight=weight), self.assertRaises(ValueError):
                self.studio.validate_project(modified)

    def test_studio_requires_explicitly_resolved_deployment_limits(self):
        for key in ("minStudioBpm", "maxStudioBpm", "studioBeatChoices", "studioBlockBeatChoices", "maxProjectBlocks", "maxProjects", "maxClipSeconds", "maxClipKeys"):
            self.provider.limits = {name: value for name, value in LIMITS.items() if name != key}
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, key):
                Studio(self.provider)
        for key in ("minStudioBpm", "maxStudioBpm"):
            self.provider.limits = {**LIMITS, key: 100.5}
            with self.assertRaisesRegex(ValueError, "integer"):
                Studio(self.provider)

    def test_sequence_blocks_have_exact_beat_budget_and_neutral_bounded_transitions(self):
        authored = sequence("head-bob", "side-sway", "hello")
        authored["parameters"]["moveSize"] = 0.6
        saved = self.studio.save(authored)
        self.assertEqual(saved["version"], 2)
        self.assertEqual(saved["clip"]["duration"], 15)
        self.assertEqual(len(saved["clip"]["keys"]), 193)
        self.assertEqual([block["moveSize"] for block in saved["blocks"]], [0.3] * 3)
        self.assertEqual(saved["training"], {"behaviorId": "imitate", "weights": {"travel": 0}})
        keys = saved["clip"]["keys"]
        self.assertEqual(len({key["t"] for key in keys}), len(keys))
        for boundary in (0, 64, 128, 192):
            self.assertEqual(keys[boundary]["joints"], [0.0] * 14)
            self.assertEqual(keys[boundary]["rootPitch"], 0)
        self.assertEqual([keys[index]["t"] for index in (0, 64, 128, 192)], [0, 5, 10, 15])
        self.assertTrue(all(-0.2 <= joint <= 0.2 for key in keys for joint in key["joints"]))
        self.assertEqual(self.studio.project(saved["id"]), saved)

    def test_reorder_remove_and_duplicate_save_new_revisions_without_mutating_original(self):
        original = self.studio.save(sequence("head-bob", "side-sway", "hello"))
        for order in (("hello", "head-bob", "side-sway"), ("head-bob",), ("head-bob", "head-bob")):
            authored = sequence(*order)
            authored["projectId"] = original["projectId"]
            saved = self.studio.save(authored)
            self.assertNotEqual(saved["id"], original["id"])
            self.assertNotEqual(saved["sha256"], original["sha256"])
            self.assertEqual(saved["projectId"], original["projectId"])
            self.assertEqual([block["template"]["id"] for block in saved["blocks"]], list(order))
            self.assertEqual(self.studio.project(original["id"]), original)

    def test_sequence_training_resolves_all_blocks_not_the_first_action(self):
        saved = self.studio.save(sequence("stand", "head-bob"))
        self.assertEqual(saved["template"]["behaviorId"], "stand")
        self.assertEqual(saved["training"], {"behaviorId": "imitate", "weights": {"travel": 0}})
        standing = self.studio.save(sequence("stand", "stand"))
        self.assertEqual(standing["training"], {"behaviorId": "stand", "weights": {}})

    def test_sequence_rejects_invalid_blocks_total_beats_and_deployment_bounds(self):
        authored = sequence("head-bob", "hello")
        candidates = [{**authored, "blocks": value} for value in (None, [], authored["blocks"] * 5)]
        for key, value in (("templateId", "unknown"), ("templateId", []), ("templateVersion", True),
                           ("beats", 3), ("beats", 16), ("moveSize", -0.1), ("moveSize", float("nan")), ("extra", 1)):
            changed = copy.deepcopy(authored)
            changed["blocks"][0][key] = value
            candidates.append(changed)
        changed = copy.deepcopy(authored)
        changed["templateId"] = "stand"
        candidates.append(changed)
        for changed in candidates:
            with self.subTest(recipe=changed), self.assertRaises(ValueError):
                self.studio.validate_recipe(changed)
        self.provider.limits["maxProjectBlocks"] = 1
        with self.assertRaisesRegex(ValueError, "bounded"):
            Studio(self.provider).compile(authored, profile())
        self.provider.limits.update(maxProjectBlocks=8, maxClipKeys=128)
        with self.assertRaisesRegex(ValueError, "maxClipKeys"):
            Studio(self.provider).compile(authored, profile())
        self.provider.limits["maxClipKeys"] = 129
        self.assertEqual(len(Studio(self.provider).compile(authored, profile())["keys"]), 129)

    def test_frozen_sequence_rejects_block_or_training_rewrites_even_with_new_hash(self):
        saved = self.studio.save(sequence("head-bob", "hello"))
        changed = copy.deepcopy(saved)
        changed["blocks"][1]["moveSize"] = 0.1
        candidates = [changed]
        changed = copy.deepcopy(saved)
        changed["training"]["behaviorId"] = "stand"
        candidates.append(changed)
        changed = copy.deepcopy(saved)
        changed["training"]["weights"]["travel"] = True
        candidates.append(changed)
        for changed in candidates:
            changed["sha256"] = bridge.digest({key: value for key, value in changed.items() if key != "sha256"})
            with self.assertRaises(ValueError):
                self.studio.validate_project(changed)

    def test_all_templates_compile_bounded_joint_ordered_closed_clips(self):
        for template, _, _ in TEMPLATES:
            for size in (0, 1):
                value = recipe(template)
                value["parameters"]["moveSize"] = size
                clip = self.studio.compile(value, profile())
                bridge.validate_clip(clip, LIMITS)
                self.assertEqual(clip["duration"], 20)
                self.assertLessEqual(len(clip["keys"]), 512)
                for key in clip["keys"]:
                    self.assertEqual(len(key["joints"]), 14)
                    self.assertTrue(all(-0.2 <= joint <= 0.2 for joint in key["joints"]))
                self.assertEqual(clip["keys"][0]["joints"], clip["keys"][-1]["joints"])
                if size == 0 or template == "stand":
                    self.assertTrue(all(key["joints"] == [0.0] * 14 for key in clip["keys"]))
                else:
                    self.assertTrue(any(any(joint != 0 for joint in key["joints"]) for key in clip["keys"]))
        self.provider.limits["maxClipKeys"] = 3
        with self.assertRaisesRegex(ValueError, "maxClipKeys"):
            Studio(self.provider).compile(recipe(), profile())
        self.provider.limits["maxClipSeconds"] = 19
        with self.assertRaisesRegex(ValueError, "duration"):
            Studio(self.provider).compile(recipe(), profile())

    def test_unicode_names_preserve_display_and_reject_controls_or_excess_length(self):
        saved = self.studio.save(recipe())
        self.assertEqual(saved["recipe"]["name"], recipe()["name"])
        self.assertEqual(saved["clip"]["name"], recipe()["name"])
        self.assertLessEqual(len(saved["recipe"]["name"].encode("utf-8")), 256)
        self.assertEqual(saved["clip"]["name"], self.studio.compile(recipe(), profile())["name"])
        self.assertEqual(self.studio.project(saved["id"]), saved)
        for name in ("🦆" * 64, "../display-only-鸭鸭"):
            unicode_project = self.studio.save({**recipe(), "name": name})
            self.assertEqual(unicode_project["recipe"]["name"], name)
            self.assertEqual(unicode_project["clip"]["name"], name)
            self.assertLessEqual(len(name.encode("utf-8")), 256)
            self.assertTrue((self.provider.root / "projects" / (unicode_project["id"] + ".json")).is_file())
        for name in (chr(0), chr(0x85), chr(0xD800), "🦆" * 65):
            with self.subTest(name=repr(name)), self.assertRaisesRegex(ValueError, "display name"):
                self.studio.save({**recipe(), "name": name})

    def test_recipe_rejects_unknown_fields_types_versions_and_music_mismatch(self):
        cases = []
        for key, value in (("name", "   "), ("profileId", "other"), ("templateId", "invented"),
                           ("templateVersion", True), ("projectId", "project-../escape")):
            cases.append({**recipe(), key: value})
        cases.append({**recipe(), "code": "never execute"})
        for key, value in (("moveSize", -0.1), ("moveSize", 1.1), ("moveSize", math.nan),
                           ("bpm", True), ("bpm", 201), ("beats", 17), ("beats", False)):
            candidate = recipe()
            candidate["parameters"][key] = value
            cases.append(candidate)
        for key, value in (("seed", -1), ("style", "upload"), ("version", True), ("bpm", 100), ("beats", 16)):
            candidate = recipe()
            candidate["music"][key] = value
            cases.append(candidate)
        for value in cases:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.studio.save(value)
        self.assertFalse((self.provider.root / "projects").exists())

    def test_save_creates_immutable_revisions_with_same_project_and_content_hash(self):
        self.assertEqual(self.studio.projects(), [])
        first = self.studio.save(recipe())
        path = self.provider.root / "projects" / (first["id"] + ".json")
        original = path.read_bytes()
        next_recipe = recipe("side-sway")
        next_recipe["projectId"] = first["projectId"]
        second = self.studio.save(next_recipe)
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(first["projectId"], second["projectId"])
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(self.studio.project(first["id"]), first)
        self.assertEqual(self.studio.projects(), [first, second])
        self.assertEqual(first["sha256"], bridge.digest({k: v for k, v in first.items() if k != "sha256"}))
        first["clip"]["name"] = "caller changed"
        self.assertNotEqual(self.studio.project(first["id"])["clip"]["name"], first["clip"]["name"])
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_project_identity_must_belong_to_this_session(self):
        value = recipe()
        value["projectId"] = "project-" + str(uuid.uuid4())
        with self.assertRaisesRegex(ValueError, "unknown project"):
            self.studio.save(value)
        self.assertEqual(self.studio.projects(), [])

    def test_concurrent_admission_enforces_revision_cap_without_overwrite(self):
        self.studio.max_projects = 2
        def save(_):
            try:
                return self.studio.save(recipe())
            except ValueError as exc:
                self.assertIn("maximum project revisions", str(exc))
                return None
        with ThreadPoolExecutor(max_workers=4) as pool:
            saved = list(pool.map(save, range(8)))
        accepted = [value for value in saved if value is not None]
        self.assertEqual(len(accepted), 2)
        self.assertEqual(len({value["id"] for value in accepted}), 2)
        self.assertEqual(len(self.studio.projects()), 2)
        self.assertFalse(list((self.provider.root / "projects").glob("*.tmp")))

    def test_rejects_traversal_symlink_directory_symlink_file_and_nonregular_file(self):
        for value in ("../escape", "revision-" + "0" * 36, "revision-00000000-0000-0000-0000-000000000000/escape"):
            with self.assertRaisesRegex(ValueError, "identity"):
                self.studio.project(value)
        outside = self.provider.root / "outside"
        outside.mkdir()
        directory = self.provider.root / "projects"
        directory.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(OSError):
            self.studio.save(recipe())
        self.assertEqual(list(outside.iterdir()), [])
        directory.unlink()
        first = self.studio.save(recipe())
        path = directory / (first["id"] + ".json")
        path.unlink()
        target = outside / "target.json"
        target.write_text(json.dumps(first))
        path.symlink_to(target)
        with self.assertRaises(OSError):
            self.studio.project(first["id"])
        path.unlink()
        os.mkfifo(path)
        with self.assertRaisesRegex(ValueError, "regular file"):
            self.studio.project(first["id"])

    def test_durable_project_rejects_hash_version_fields_identity_and_clip_corruption(self):
        first = self.studio.save(recipe())
        path = self.provider.root / "projects" / (first["id"] + ".json")
        candidates = []
        changed = copy.deepcopy(first)
        changed["recipe"]["name"] = "changed"
        candidates.append(changed)
        for key, value in (("version", 1), ("version", True), ("createdAt", "not-a-date"),
                           ("id", "revision-" + str(uuid.uuid4())), ("extra", {})):
            changed = {**copy.deepcopy(first), key: value}
            changed["sha256"] = bridge.digest({k: v for k, v in changed.items() if k != "sha256"})
            candidates.append(changed)
        changed = copy.deepcopy(first)
        changed["clip"]["keys"][1]["joints"][0] = 0.1
        changed["sha256"] = bridge.digest({k: v for k, v in changed.items() if k != "sha256"})
        candidates.append(changed)
        for changed in candidates:
            path.write_text(json.dumps(changed))
            with self.subTest(changed=changed.keys()), self.assertRaises(ValueError):
                self.studio.project(first["id"])
        path.write_text("x" * (65536 + LIMITS["maxClipKeys"] * 1024 + 1))
        with self.assertRaisesRegex(ValueError, "size limit"):
            self.studio.project(first["id"])
        for value in ('{"version":1,"version":2}', '{"value":NaN}', '{"value":Infinity}'):
            with self.assertRaises(ValueError):
                strict_json(value)

    def test_explicit_unbound_training_clips_obey_loaded_model_limits_before_admission(self):
        clip = self.studio.compile(recipe(), profile())
        spec = {"name": "Explicit clip", "behaviorId": "stand", "steps": 8, "envs": 1, "seed": 0,
                "actuator": "bam", "weights": {}, "clip": clip}
        modules = {"microduck_local.behaviors": SimpleNamespace(BEHAVIORS={"stand": SimpleNamespace(clip_name=None, terms=[])}, CATALOG={})}
        with (patch.dict(sys.modules, modules), patch.object(self.provider, "studio", return_value=self.studio),
              patch.object(bridge, "trainer_provenance", side_effect=AssertionError("invalid clip reached trainer"))):
            for index in range(14):
                for target in (-0.21, 0.21):
                    candidate = copy.deepcopy(spec)
                    candidate["clip"]["keys"][1]["joints"][index] = target
                    bridge.validate_clip(candidate["clip"], LIMITS)
                    with self.subTest(index=index, target=target), self.assertRaisesRegex(ValueError, JOINTS[index]):
                        self.provider.prepare_train("run-" + str(uuid.uuid4()), candidate)
        self.assertFalse((self.provider.root / "runs").exists())
        endpoint_clip = copy.deepcopy(clip)
        endpoint_clip["keys"][1]["joints"] = [-0.2, 0.2] * 7
        self.studio.validate_clip_targets(endpoint_clip, profile())

    def test_template_rejects_missing_joint_names_instead_of_dropping_motion(self):
        incomplete = profile()
        incomplete["joints"][3]["name"] = "misspelled_left_knee"
        with self.assertRaisesRegex(ValueError, "left_knee"):
            self.studio.compile(recipe("tiny-march"), incomplete)

    def test_listing_reports_a_revision_disappearing_after_directory_open(self):
        self.studio.save(recipe())
        with patch.object(self.studio, "_projects", side_effect=FileNotFoundError("revision disappeared")):
            with self.assertRaisesRegex(FileNotFoundError, "revision disappeared"):
                self.studio.projects()

    def test_prepare_train_freezes_project_and_rejects_caller_snapshot_and_mismatched_clip(self):
        project = self.studio.save(recipe())
        spec = {"name": "Project train", "behaviorId": "stand", "steps": 8, "envs": 1, "seed": 0,
                "actuator": "bam", "weights": {}, "clip": project["clip"], "projectRevisionId": project["id"]}
        modules = {"microduck_local.behaviors": SimpleNamespace(BEHAVIORS={"stand": SimpleNamespace(clip_name=None, terms=[])}, CATALOG={})}
        trainer = {"backend": "cpu", "learnerDevice": "cpu", "physicsDevice": "cpu",
                   "helperSha256": {}}
        trainer["sha256"] = bridge.digest(trainer)
        with (patch.dict(sys.modules, modules), patch.object(self.provider, "studio", return_value=self.studio),
              patch.object(bridge, "trainer_provenance", return_value=trainer),
              patch.object(bridge, "runtime_versions", return_value={}), patch.object(bridge, "bam_provenance", return_value={}),
              patch.object(self.provider, "fingerprint", return_value="source")):
            with self.assertRaisesRegex(ValueError, "unsupported fields"):
                bridge.validate_spec({**spec, "projectSnapshot": project}, LIMITS)
            for name in (project["clip"]["name"], "../train", " ", "x" * 65):
                with self.assertRaisesRegex(ValueError, "training name"):
                    bridge.validate_spec({**spec, "name": name}, LIMITS)
            mismatched = copy.deepcopy(project["clip"])
            mismatched["keys"][1]["joints"][0] += 0.01
            with self.assertRaisesRegex(ValueError, "explicit clip"):
                self.provider.prepare_train("run-" + str(uuid.uuid4()), {**spec, "clip": mismatched})
            run_id = "run-" + str(uuid.uuid4())
            run = self.provider.prepare_train(run_id, {**spec, "clip": None})
            self.assertEqual(run["spec"]["clip"], project["clip"])
            self.assertEqual(run["formatVersion"], 3)
            self.assertEqual(run["spec"]["projectSnapshot"], project)
            self.assertNotIn("projectSnapshot", spec)
            self.assertEqual(self.provider.run(run_id)["spec"]["projectSnapshot"], project)
            # A run consumes its frozen snapshot, not a later project file lookup.
            (self.provider.root / "projects" / (project["id"] + ".json")).unlink()
            self.assertEqual(self.provider.run(run_id)["spec"]["projectSnapshot"], project)
            run["spec"]["projectSnapshot"]["sha256"] = "0" * 64
            run["recipeHash"] = bridge.digest(run["spec"])
            bridge.write_json(self.provider.path(run_id) / "manifest.json", run)
            with self.assertRaisesRegex(ValueError, "project content hash"):
                self.provider.run(run_id)


@unittest.skipUnless(os.environ.get("ROBOT_STUDIO_SOURCE"), "set ROBOT_STUDIO_SOURCE for installed CPU MuJoCo proof")
class RealStudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.provider = bridge.Bridge(Path(os.environ["ROBOT_STUDIO_SOURCE"]), Path(cls.temporary.name), LIMITS)
        cls.studio = Studio(cls.provider)
        cls.model = cls.studio.model()

    @classmethod
    def tearDownClass(cls):
        # Destroy the native model while MuJoCo's module state is still alive.
        del cls.model
        del cls.studio
        cls.temporary.cleanup()

    def test_reference_frame_cap_requires_two_endpoints_but_simulation_accepts_one_step(self):
        project = self.studio.save(recipe("stand"))
        with patch.dict(self.provider.limits, maxSimulationSteps=1):
            with self.assertRaisesRegex(ValueError, "reference_preview requires maxSimulationSteps >= 2"):
                self.studio.preview(project["id"])
            simulation = self.provider.simulate({"policyId": "shipped:alpha_stand", "steps": 1,
                                                 "seed": 11, "command": [0, 0, 0]})
            self.assertEqual(simulation["mode"], "recorded-simulation")
            self.assertEqual(simulation["frames"][-1]["step"], 1)
        with patch.dict(self.provider.limits, maxSimulationSteps=2):
            preview = self.studio.preview(project["id"])
            self.assertEqual([frame["time"] for frame in preview["frames"]], [0, project["clip"]["duration"]])

    def test_model_metadata_and_reference_preview_are_real_kinematic_states(self):
        import mujoco
        import numpy as np
        with patch.object(bridge, "mlx_probe", side_effect=AssertionError("studio must not initialize MLX")):
            catalog = self.studio.catalog()
            actual_profile = catalog["profiles"][0]
            self.assertEqual(actual_profile["rootBody"], {"name": "trunk_base", "index": 1})
            for joint in actual_profile["joints"]:
                actual = self.model.joint(joint["name"])
                self.assertEqual(joint["index"], actual.id)
                self.assertEqual([joint["lower"], joint["upper"]], actual.range.tolist())
                self.assertEqual(joint["defaultPosition"], self.model.key("STAND").qpos[int(actual.qposadr[0])])
            project = self.studio.save(sequence("head-bob", "side-sway", "look-around", "hello"))
            with (patch.object(mujoco, "mj_step", side_effect=AssertionError("reference cannot integrate dynamics")),
                  patch.object(mujoco, "mj_differentiatePos", side_effect=AssertionError("reference cannot infer measured velocities")),
                  patch.object(mujoco, "mj_objectVelocity", side_effect=AssertionError("reference cannot measure body velocity"))):
                preview = self.studio.preview(project["id"])
            self.assertEqual(preview["mode"], "kinematic-reference")
            self.assertEqual(preview["projectSha256"], project["sha256"])
            self.assertEqual(preview["frames"][-1]["time"], project["clip"]["duration"])
            self.assertLessEqual(len(preview["frames"]), LIMITS["maxSimulationSteps"])
            self.assertEqual(len(preview["frames"]), 1001)
            neutral = [joint["defaultPosition"] for joint in actual_profile["joints"]]
            for index in (0, 250, 500, 750, 1000):
                np.testing.assert_allclose(preview["frames"][index]["telemetry"]["jointPosition"], neutral, atol=1e-12)
            layout = model_layout(self.model)
            data = mujoco.MjData(self.model)
            mujoco.mj_resetDataKeyframe(self.model, data, self.model.key("STAND").id)
            frame = preview["frames"][173]
            data.qpos[layout["qpos"]] = frame["telemetry"]["jointPosition"]
            mujoco.mj_forward(self.model, data)
            np.testing.assert_allclose(frame["bodies"], np.column_stack((data.xpos, data.xquat)), atol=1e-12)
            for frame in preview["frames"]:
                state = frame["telemetry"]
                self.assertEqual(len(state["jointPosition"]), 14)
                for key in ("jointVelocity", "rootLinearVelocityWorld", "rootSpeed", "controllerTarget", "actuatorTorque"):
                    self.assertIsNone(state[key])
                self.assertTrue(math.isfinite(state["rootTilt"]))
                self.assertEqual(state["rootBody"], "trunk_base")
                self.assertTrue(np.isfinite(np.asarray(frame["bodies"])).all())
            self.assertTrue(any(any(abs(value - neutral[index]) > 0.01
                                    for index, value in enumerate(frame["telemetry"]["jointPosition"]))
                                for frame in preview["frames"]))
            print(f"CPU reference proof: {len(preview['frames'])} mj_forward frames, model={actual_profile['modelSha256']}, revision={project['id']}")

    def test_process_operations_train_and_replay_the_frozen_project_revision(self):
        with tempfile.TemporaryDirectory() as temporary:
            environment = {key: value for key, value in os.environ.items()
                           if not any(secret in key.upper() for secret in ("KEY", "SECRET", "TOKEN", "PASSWORD"))}
            environment.update(PYTHONDONTWRITEBYTECODE="1", OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1",
                               MKL_NUM_THREADS="1", VECLIB_MAXIMUM_THREADS="1")
            def request(value):
                result = subprocess.run([sys.executable, "-B", str(Path(bridge.__file__)),
                    "--source", os.environ["ROBOT_STUDIO_SOURCE"], "--root", temporary],
                    input=json.dumps({"limits": LIMITS, "request": value}), text=True,
                    capture_output=True, check=False, timeout=60, env=environment)
                self.assertEqual(result.returncode, 0, result.stderr)
                return json.loads(result.stdout)
            catalog = request({"operation": "studio"})
            self.assertEqual(set(catalog), {"operation", "catalog"})
            saved = request({"operation": "save_project", "recipe": sequence("stand", "hello", "head-bob", "hello")})
            project = saved["project"]
            self.assertEqual(set(saved), {"operation", "project"})
            listing = request({"operation": "projects"})
            self.assertEqual(listing["projects"], [project])
            loaded = request({"operation": "project", "projectRevisionId": project["id"]})
            self.assertEqual(loaded["project"], project)
            preview = request({"operation": "reference_preview", "projectRevisionId": project["id"]})["preview"]
            self.assertEqual(preview["mode"], "kinematic-reference")
            self.assertEqual(preview["projectSha256"], project["sha256"])
            self.assertEqual(preview["projectRevisionId"], project["id"])
            self.assertEqual(len(preview["frames"]), 1001)
            run_id = "run-" + str(uuid.uuid4())
            admitted = request({"operation": "prepare_train", "runId": run_id, "spec": {
                "name": "project-" + project["id"], "behaviorId": project["training"]["behaviorId"], "steps": 32, "envs": 1,
                "seed": 17, "actuator": "bam", "weights": project["training"]["weights"], "clip": None,
                "projectRevisionId": project["id"]}})["run"]
            self.assertEqual(admitted["formatVersion"], 3)
            self.assertEqual(admitted["state"], "starting")
            self.assertEqual(admitted["spec"]["projectSnapshot"], project)
            self.assertEqual(admitted["spec"]["backend"], "cpu")
            self.assertEqual(admitted["provenance"]["bridgeSha256"], bridge.bridge_hash())
            persisted = request({"operation": "run", "runId": run_id})["run"]
            self.assertEqual(persisted["spec"], admitted["spec"])
            self.assertFalse((Path(temporary) / "runs" / run_id / "policy.onnx").exists())
            self.assertEqual(admitted["provenance"]["trainer"]["helperSha256"], {})
            self.assertEqual(admitted["spec"]["clip"], project["clip"])
            self.assertEqual(project["template"]["behaviorId"], "stand")
            self.assertEqual(admitted["spec"]["behaviorId"], "imitate")
            self.assertEqual(admitted["spec"]["weights"], {"travel": 0})
            self.assertEqual(len(project["blocks"]), 4)
            next_recipe = sequence("hello", "head-bob", "head-bob")
            next_recipe["projectId"] = project["projectId"]
            newer = request({"operation": "save_project", "recipe": next_recipe})["project"]
            self.assertNotEqual(newer["id"], project["id"])
            # Training must consume its snapshot without reopening even the original revision.
            (Path(temporary) / "projects" / (project["id"] + ".json")).unlink()
            trained = request({"operation": "train", "runId": run_id})["run"]
            self.assertEqual(trained["state"], "completed")
            self.assertEqual(trained["spec"]["projectSnapshot"], project)
            self.assertEqual(trained["recipeHash"], admitted["recipeHash"])
            policy_id = trained["policyId"]
            simulation = request({"operation": "simulate", "policyId": policy_id,
                                  "steps": 8, "seed": 17, "command": [0, 0, 0]})["simulation"]
            self.assertEqual(simulation["policyHash"], trained["policySha256"])
            self.assertTrue(simulation["frames"])
            for frame in simulation["frames"]:
                self.assertEqual(len(frame["telemetry"]["jointPosition"]), 14)
                self.assertEqual(len(frame["telemetry"]["controllerTarget"]), 14)
                self.assertEqual(len(frame["telemetry"]["actuatorTorque"]), 14)
            evaluation = request({"operation": "evaluate", "spec": {"policyId": policy_id,
                "episodes": 1, "stepsPerEpisode": 8, "seed": 17,
                "maxTerminations": 1, "minMeanUprightFraction": 0}})["evaluation"]
            self.assertEqual(evaluation["policyHash"], trained["policySha256"])
            self.assertIsNotNone(evaluation["episodes"][0]["poseRmse"])
            print(f"CPU frozen project proof: catalog/save/preview/prepare/train32/export/simulate/evaluate; "
                  f"actual training transitions={trained['progress']['steps']}, replay frames={len(simulation['frames'])}, "
                  f"poseRmse={evaluation['episodes'][0]['poseRmse']:.6f}; integration only, no learned-dance claim")

    def test_tiny_march_drives_actual_leg_joints_and_unbound_admission_rejects_mjcf_violations(self):
        from microduck_local import contract as C
        actual_profile = self.studio.profile()
        self.assertEqual([joint["name"] for joint in actual_profile["joints"]], list(C.JOINT_NAMES))
        value = recipe("tiny-march")
        value["parameters"]["moveSize"] = 1
        clip = self.studio.compile(value, actual_profile)
        amplitudes = {}
        for name in ("left_hip_pitch", "left_knee", "left_ankle", "right_hip_pitch", "right_knee", "right_ankle"):
            index = list(C.JOINT_NAMES).index(name)
            default = actual_profile["joints"][index]["defaultPosition"]
            amplitudes[name] = max(abs(key["joints"][index] - default) for key in clip["keys"])
            self.assertGreater(amplitudes[name], 0.04)
        self.studio.validate_clip_targets(clip, actual_profile)
        spec = {"name": "MJCF range proof", "behaviorId": "imitate", "steps": 32, "envs": 1,
                "seed": 17, "actuator": "bam", "weights": {}, "clip": clip}
        with (patch.object(self.provider, "studio", return_value=self.studio),
              patch.object(bridge, "trainer_provenance", side_effect=AssertionError("out-of-range target reached trainer"))):
            for index, joint in enumerate(actual_profile["joints"]):
                for target in (joint["lower"] - 0.01, joint["upper"] + 0.01):
                    invalid = copy.deepcopy(spec)
                    invalid["clip"]["keys"][1]["joints"][index] = target
                    bridge.validate_clip(invalid["clip"], LIMITS)
                    with self.assertRaisesRegex(ValueError, joint["name"]):
                        self.provider.prepare_train("run-" + str(uuid.uuid4()), invalid)
        print("Tiny March actual MJCF joint amplitudes (rad): " + json.dumps(amplitudes, sort_keys=True))

    def test_world_velocity_tilt_and_joint_order_use_mujoco_data(self):
        import mujoco
        import numpy as np
        data = mujoco.MjData(self.model)
        mujoco.mj_resetDataKeyframe(self.model, data, self.model.key("STAND").id)
        layout = model_layout(self.model)
        data.qpos[3:7] = [math.cos(0.2), 0, math.sin(0.2), 0]
        data.qvel[:3] = [0.2, -0.3, 0.1]
        data.qvel[layout["qvel"]] = np.arange(14) / 10
        data.ctrl[:] = np.arange(14) / 20
        mujoco.mj_forward(self.model, data)
        state = telemetry(self.model, data, layout)
        expected = np.zeros(6)
        mujoco.mj_objectVelocity(self.model, data, mujoco.mjtObj.mjOBJ_BODY, layout["rootBody"], expected, 0)
        np.testing.assert_allclose(state["rootLinearVelocityWorld"], expected[3:])
        self.assertAlmostEqual(state["rootSpeed"], np.linalg.norm(expected[3:]))
        self.assertAlmostEqual(state["rootTilt"], 0.4)
        np.testing.assert_allclose(state["jointPosition"], data.qpos[layout["qpos"]])
        np.testing.assert_allclose(state["jointVelocity"], data.qvel[layout["qvel"]])
        np.testing.assert_allclose(state["controllerTarget"], data.ctrl[layout["actuators"]])
        np.testing.assert_allclose(state["actuatorTorque"], data.qfrc_actuator[layout["qvel"]])
        reference = telemetry(self.model, data, layout, reference=True)
        self.assertEqual(reference["jointPosition"], state["jointPosition"])
        self.assertEqual(reference["rootTilt"], state["rootTilt"])
        for key in ("jointVelocity", "rootLinearVelocityWorld", "rootSpeed", "controllerTarget", "actuatorTorque"):
            self.assertIsNone(reference[key])

    def test_bounded_bam_rollout_records_actual_targets_and_applied_torque(self):
        import numpy as np
        from microduck_local.walk_env import MicroduckWalkEnv
        original = MicroduckWalkEnv.step
        observed = []
        def capture(env, action):
            result = original(env, action)
            observed.append({"position": env.data.qpos[env.joint_qpos_adr].copy(),
                             "velocity": env.data.qvel[env.joint_qvel_adr].copy(),
                             "target": env.data.ctrl.copy(), "torque": env.bam.applied_torque.copy()})
            return result
        with patch.object(MicroduckWalkEnv, "step", capture):
            simulation = self.provider.simulate({"policyId": "shipped:alpha_stand", "steps": 8, "seed": 11, "command": [0, 0, 0]})
        self.assertEqual(simulation["mode"], "recorded-simulation")
        self.assertEqual(simulation["frames"][-1]["step"], 8)
        for frame in simulation["frames"]:
            expected = observed[frame["step"] - 1]
            for field, key in (("jointPosition", "position"), ("jointVelocity", "velocity"),
                               ("controllerTarget", "target"), ("actuatorTorque", "torque")):
                np.testing.assert_allclose(frame["telemetry"][field], expected[key], atol=1e-12)
        print(f"CPU BAM proof: 8 actual policy steps, {len(simulation['frames'])} frames with qpos/qvel/target/torque telemetry")


if __name__ == "__main__":
    unittest.main()
