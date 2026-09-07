"""Export exact installed model metadata for authoring; no physics steps."""
import hashlib
import importlib.util
import json
from pathlib import Path
import mujoco
import numpy as np
from microduck_local import contract as C

out = Path(__file__).resolve().parent
repo = out.parent.parent
original = json.loads((repo / 'artifacts/microduck-dances/model.json').read_text())
profile = original['profile']
model = mujoco.MjModel.from_xml_path(str(C.SCENE_WALK_XML))
buffer = np.empty(mujoco.mj_sizeModel(model), dtype=np.uint8)
mujoco.mj_saveModel(model, buffer=buffer)
assert hashlib.sha256(buffer.tobytes()).hexdigest() == profile['modelSha256']
data = mujoco.MjData(model)
mujoco.mj_resetDataKeyframe(model, data, model.key('STAND').id)
for joint in profile['joints']:
    native = model.joint(joint['name'])
    assert data.qpos[int(native.qposadr[0])] == joint['defaultPosition']
    assert np.array_equal(native.range, [joint['lower'], joint['upper']])
spec = importlib.util.spec_from_file_location('scene_kinematics', repo / 'packages/robot/robot-lab-microduck/python/scene_kinematics.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
names = [j['name'] for j in profile['joints']]
scene = {'bodies': [model.body(i).name for i in range(model.nbody)], 'meshes': [], 'geoms': [],
         'defaultJoints': [j['defaultPosition'] for j in profile['joints']], 'jointNames': names,
         'kinematics': module.scene_kinematics(model, names)}
result = {**original, 'scene': scene, 'mujocoVersion': mujoco.__version__}
(out / 'model.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'modelSha256': profile['modelSha256'], 'rootPosition': scene['kinematics']['rootPosition'],
                  'bodies': len(scene['bodies']), 'physicsSteps': 0}))
