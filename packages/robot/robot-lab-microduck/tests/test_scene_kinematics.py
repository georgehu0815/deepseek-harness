"""Real-model metadata checks for the browser's native MicroDuck pose stage."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from scene_kinematics import scene_kinematics

try:
    import mujoco
    from microduck_local import contract as C
except ImportError:
    mujoco = None


@unittest.skipIf(mujoco is None, "requires the installed MuJoCo and MicroDuck model environment")
class SceneKinematicsTests(unittest.TestCase):
    def setUp(self):
        self.model = mujoco.MjModel.from_xml_path(str(C.SCENE_WALK_XML))

    def test_metadata_matches_the_compiled_model_and_browser_parity_fixture(self):
        rig = scene_kinematics(self.model, C.JOINT_NAMES)
        fixture = Path(__file__).resolve().parents[3] / "client/ui-robot-lab/tests/fixtures/clip-pose-mujoco.json"
        self.assertEqual(rig, json.loads(fixture.read_text())["scene"]["kinematics"])
        self.assertEqual(len(rig["joints"]), 14)
        self.assertEqual(len(rig["bodies"]), self.model.nbody)
        for name, joint in zip(C.JOINT_NAMES, rig["joints"]):
            compiled = self.model.joint(name)
            self.assertEqual(joint["body"], int(self.model.jnt_bodyid[compiled.id]))
            self.assertEqual(joint["reference"], self.model.qpos0[compiled.qposadr[0]])
        self.assertNotEqual([j["reference"] for j in rig["joints"]], C.DEFAULT_POSE.tolist())

    def test_bridge_scene_publishes_meshes_and_the_same_model_rig(self):
        # A private cwd keeps Vitest's coverage/ output from shadowing Numba's optional coverage module.
        with tempfile.TemporaryDirectory() as directory:
            env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "python"),
                   "NUMBA_CACHE_DIR": directory, "MPLCONFIGDIR": directory}
            result = subprocess.run([sys.executable, "-c",
                "from bridge import Bridge; import json; scene = Bridge.__new__(Bridge).scene(); "
                "scene['meshes'] = len(scene['meshes']); scene['geoms'] = len(scene['geoms']); "
                "print(json.dumps(scene))"], cwd=directory, env=env, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        scene = json.loads(result.stdout)
        self.assertEqual(scene["kinematics"], scene_kinematics(self.model, C.JOINT_NAMES))
        self.assertEqual(scene["bodies"], [self.model.body(b).name for b in range(self.model.nbody)])
        self.assertEqual(scene["jointNames"], list(C.JOINT_NAMES))
        self.assertGreater(scene["meshes"], 0)
        self.assertGreater(scene["geoms"], 0)

    def test_rejects_missing_or_duplicate_named_hinges(self):
        for names in (C.JOINT_NAMES[:-1], [C.JOINT_NAMES[0]] * 14):
            with self.assertRaisesRegex(ValueError, "fourteen named hinges"):
                scene_kinematics(self.model, names)

    def test_rejects_nonhinge_and_nonworld_free_root_models(self):
        self.model.jnt_type[self.model.joint(C.JOINT_NAMES[0]).id] = mujoco.mjtJoint.mjJNT_SLIDE
        with self.assertRaisesRegex(ValueError, "fourteen named hinges"):
            scene_kinematics(self.model, C.JOINT_NAMES)
        self.model.jnt_type[self.model.joint(C.JOINT_NAMES[0]).id] = mujoco.mjtJoint.mjJNT_HINGE
        self.model.body_parentid[1] = 2
        with self.assertRaisesRegex(ValueError, "world-parented"):
            scene_kinematics(self.model, C.JOINT_NAMES)


if __name__ == "__main__":
    unittest.main()
