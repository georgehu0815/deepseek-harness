"""Check authored targets with installed MuJoCo forward kinematics; never advance physics."""
import hashlib
import json
from pathlib import Path

import mujoco
import numpy as np
from microduck_local import contract as C

out = Path(__file__).resolve().parent
manifest = json.loads((out / "manifest.json").read_text())
profile = json.loads((out / "model.json").read_text())["profile"]
model = mujoco.MjModel.from_xml_path(str(C.SCENE_WALK_XML))
buffer = np.empty(mujoco.mj_sizeModel(model), dtype=np.uint8)
mujoco.mj_saveModel(model, buffer=buffer)
model_hash = hashlib.sha256(buffer.tobytes()).hexdigest()
assert model_hash == profile["modelSha256"]
data = mujoco.MjData(model)
addresses = [int(model.joint(j["name"]).qposadr[0]) for j in profile["joints"]]
neutral = np.array([j["defaultPosition"] for j in profile["joints"]])
mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
assert np.array_equal(data.qpos[addresses], neutral)
feet = [model.body("ankle_left").id, model.body("ankle_right").id]
mujoco.mj_kinematics(model, data)
reference_feet = data.xpos[feet].copy()
results = []
for row in manifest["clips"]:
    clip = json.loads((out / row["clipFile"]).read_text())
    times = np.array([k["t"] for k in clip["keys"]])
    joints = np.array([k["joints"] for k in clip["keys"]])
    samples = np.unique(np.concatenate((times, np.linspace(0, clip["duration"], round(clip["duration"] * 50) + 1))))
    sampled = np.column_stack([np.interp(samples, times, joints[:, j]) for j in range(14)])
    max_foot_displacement = np.zeros(2)
    max_foot_vertical_change = np.zeros(2)
    for target in sampled:
        data.qpos[addresses] = target
        mujoco.mj_kinematics(model, data)
        assert np.isfinite(data.xpos).all() and np.isfinite(data.xquat).all()
        displacement = data.xpos[feet] - reference_feet
        max_foot_displacement = np.maximum(max_foot_displacement, np.linalg.norm(displacement, axis=1))
        max_foot_vertical_change = np.maximum(max_foot_vertical_change, np.abs(displacement[:, 2]))
        assert data.xpos[feet[0], 1] > data.xpos[feet[1], 1], "Feet crossed in the model frame"
    assert np.all(max_foot_displacement < .015), "Foot body moved more than 15 mm from neutral"
    assert np.array_equal(sampled[0], neutral) and np.array_equal(sampled[-1], neutral)
    assert data.time == 0, "Physics must not advance"
    results.append({"dance": row["dance"], "clipSha256": row["clipSha256"], "sampleCount": len(samples),
                    "maxFootBodyDisplacementMeters": max_foot_displacement.tolist(),
                    "maxFootBodyVerticalChangeMeters": max_foot_vertical_change.tolist(),
                    "finiteBodyTransforms": True, "feetNotCrossed": True, "exactNeutralEndpoints": True})
report = {"modelSha256": model_hash, "mujocoVersion": mujoco.__version__, "method": "mj_kinematics only, every key plus a 50 Hz grid",
          "physicsSteps": 0, "scope": "Foot body displacement, not sole clearance, contact feasibility, balance or hardware safety", "results": results}
(out / "kinematic-verification.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
