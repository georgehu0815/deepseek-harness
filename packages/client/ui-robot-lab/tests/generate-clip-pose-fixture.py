"""Regenerate browser FK expectations with the installed MicroDuck MuJoCo model, without stepping physics."""
import json
from pathlib import Path
import sys

import mujoco
import numpy as np
from microduck_local import contract as C

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "robot/robot-lab-microduck/python"))
from scene_kinematics import scene_kinematics

model = mujoco.MjModel.from_xml_path(str(C.SCENE_WALK_XML))
rig = scene_kinematics(model, C.JOINT_NAMES)
data = mujoco.MjData(model)
addresses = [int(model.joint(name).qposadr[0]) for name in C.JOINT_NAMES]
poses = [(C.DEFAULT_POSE.tolist(), 0.0),
         ([0.0] * 14, 0.0),
         ((C.DEFAULT_POSE + np.linspace(-0.25, 0.25, 14)).tolist(), -0.7),
         ((C.DEFAULT_POSE + np.linspace(0.3, -0.3, 14)).tolist(), 2 * np.pi + 0.4)]
cases = []
for joints, pitch in poses:
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    data.qpos[addresses] = joints
    data.qpos[3:7] = [np.cos(pitch / 2), 0, np.sin(pitch / 2), 0]
    mujoco.mj_forward(model, data)
    cases.append({"joints": joints, "rootPitch": pitch,
                  "bodies": [np.concatenate((data.xpos[b], data.xquat[b])).tolist()
                             for b in range(model.nbody)]})
fixture = {"scene": {"bodies": [model.body(b).name for b in range(model.nbody)],
                     "jointNames": list(C.JOINT_NAMES), "defaultJoints": C.DEFAULT_POSE.tolist(),
                     "meshes": [], "geoms": [], "kinematics": rig},
           "mujocoVersion": mujoco.__version__, "cases": cases}
destination = Path(__file__).parent / "fixtures/clip-pose-mujoco.json"
destination.parent.mkdir(exist_ok=True)
destination.write_text(json.dumps(fixture, indent=2) + "\n")
print(destination)
