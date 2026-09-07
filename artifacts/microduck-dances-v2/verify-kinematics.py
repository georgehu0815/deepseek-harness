"""Independently measure native MuJoCo forward kinematics, feet and limits; never step dynamics."""
import hashlib
import json
from pathlib import Path
import mujoco
import numpy as np
from microduck_local import contract as C

out = Path(__file__).resolve().parent
meta = json.loads((out/'model.json').read_text())
manifest = json.loads((out/'manifest.json').read_text())
profile = meta['profile']
model = mujoco.MjModel.from_xml_path(str(C.SCENE_WALK_XML))
buffer = np.empty(mujoco.mj_sizeModel(model),dtype=np.uint8)
mujoco.mj_saveModel(model,buffer=buffer)
assert hashlib.sha256(buffer.tobytes()).hexdigest()==profile['modelSha256']
data = mujoco.MjData(model)
mujoco.mj_resetDataKeyframe(model,data,model.key('STAND').id)
addresses = [int(model.joint(j['name']).qposadr[0]) for j in profile['joints']]
neutral = np.array([j['defaultPosition'] for j in profile['joints']])
feet = [model.body('ankle_left').id,model.body('ankle_right').id]
mujoco.mj_kinematics(model,data)
reference_feet = data.xpos[feet].copy()
foot_geoms = [i for i in range(model.ngeom) if model.geom_bodyid[i] in feet and (model.geom_contype[i] or model.geom_conaffinity[i])]
def minimum_foot_z():
    values=[]
    for i in foot_geoms:
        center=data.geom_xpos[i]
        matrix=data.geom_xmat[i].reshape(3,3)
        kind=model.geom_type[i]
        if kind==mujoco.mjtGeom.mjGEOM_BOX:
            values.append(center[2]-np.dot(np.abs(matrix[2]),model.geom_size[i]))
        elif kind==mujoco.mjtGeom.mjGEOM_SPHERE:
            values.append(center[2]-model.geom_size[i,0])
        elif kind==mujoco.mjtGeom.mjGEOM_MESH:
            mesh=model.geom_dataid[i]
            vertices=model.mesh_vert[model.mesh_vertadr[mesh]:model.mesh_vertadr[mesh]+model.mesh_vertnum[mesh]]
            values.append(float(np.min(vertices@matrix[2]+center[2])))
        else:
            raise AssertionError(f'Unmeasured foot geometry type {kind}')
    assert values, 'No collision foot geometry measured'
    return min(values)
neutral_sole_z=minimum_foot_z()
previous=json.loads((out.parent/'microduck-dances/kinematic-verification.json').read_text())
old={r['dance']:r for r in previous['results']}
results=[]
for row in manifest['clips']:
    raw=(out/row['clipFile']).read_bytes()
    assert hashlib.sha256(raw).hexdigest()==row['clipSha256']
    clip=json.loads(raw)
    assert clip['version']==3 and clip['modelSha256']==profile['modelSha256']
    times=np.array([k['t'] for k in clip['keys']])
    joints=np.array([k['joints'] for k in clip['keys']])
    assert np.array_equal(joints[0],neutral) and np.array_equal(joints[-1],neutral)
    assert np.all(np.diff(times)>0) and times[-1]==clip['duration']
    assert all(k['rootPitch']==0 for k in clip['keys'])
    assert np.all(joints >= np.array([j['lower'] for j in profile['joints']]))
    assert np.all(joints <= np.array([j['upper'] for j in profile['joints']]))
    roots=np.array([[*k['rootPosition'],k['rootRoll'],k['rootYaw']] for k in clip['keys']])
    samples=np.unique(np.concatenate((times,np.linspace(0,clip['duration'],round(clip['duration']*50)+1),
                                     [c['start'] for c in clip['contacts']],[c['end'] for c in clip['contacts']])))
    all_joints=np.column_stack([np.interp(samples,times,joints[:,i]) for i in range(14)])
    all_roots=np.column_stack([np.interp(samples,times,roots[:,i]) for i in range(5)])
    max_error=0; max_angle=0; max_lift=np.zeros(2); max_displacement=np.zeros(2)
    min_separation=100; min_sole_z=100
    for t,q,root in zip(samples,all_joints,all_roots):
        data.qpos[addresses]=q
        data.qpos[:3]=root[:3]
        roll,yaw=root[3:]
        cy,sy=np.cos(yaw/2),np.sin(yaw/2)
        cr,sr=np.cos(roll/2),np.sin(roll/2)
        data.qpos[3:7]=[cy*cr,cy*sr,sy*sr,sy*cr]
        mujoco.mj_kinematics(model,data)
        assert np.isfinite(data.xpos).all() and np.isfinite(data.xquat).all()
        actual=data.xpos[feet]
        max_lift=np.maximum(max_lift,actual[:,2]-reference_feet[:,2])
        max_displacement=np.maximum(max_displacement,np.linalg.norm(actual-reference_feet,axis=1))
        delta=actual[0]-actual[1]
        separation=-np.sin(yaw)*delta[0]+np.cos(yaw)*delta[1]
        min_separation=min(min_separation,separation)
        min_sole_z=min(min_sole_z,minimum_foot_z())
        contacts=[c for c in clip['contacts'] if c['start']<=t<=c['end']]
        assert contacts, f'Uncovered support at {t}'
        for c in contacts:
            index=0 if c['foot']=='left' else 1
            max_error=max(max_error,float(np.linalg.norm(actual[index]-c['position'])))
            expected=np.array([c['quaternion'][3],*c['quaternion'][:3]])
            dot=np.clip(abs(np.dot(expected,data.xquat[feet[index]])),0,1)
            max_angle=max(max_angle,float(2*np.arccos(dot)))
    speeds=np.abs(np.diff(joints,axis=0)/np.diff(times)[:,None])
    assert max_error<.0005 and max_angle<.01
    assert min_separation>.09
    assert min_sole_z>neutral_sole_z-.0006
    assert np.min(max_lift)>.015
    assert np.max(speeds)<6
    assert data.time==0
    old_displacement=np.array(old[row['dance']]['maxFootBodyDisplacementMeters'])
    results.append({'dance':row['dance'],'clipSha256':row['clipSha256'],'sampleCount':len(samples),
      'maxSupportFootDriftMeters':max_error,'maxSupportFootAngleErrorRad':max_angle,
      'maxFootLiftMeters':max_lift.tolist(),'maxFootDisplacementMeters':max_displacement.tolist(),
      'displacementRatioToOriginal':(max_displacement/old_displacement).tolist(),
      'minimumFootSeparationMeters':min_separation,'minimumCollisionFootZ':min_sole_z,
      'neutralCollisionFootZ':neutral_sole_z,'maxJointSpeedRadPerSecond':float(np.max(speeds)),
      'headingDegrees':[float(np.min(roots[:,4])*180/np.pi),float(np.max(roots[:,4])*180/np.pi)],
      'headYawExcursionDegrees':float(np.ptp(joints[:,7])*180/np.pi),'exactNeutralEndpoints':True})
    print(json.dumps(results[-1]),flush=True)
report={'modelSha256':profile['modelSha256'],'mujocoVersion':mujoco.__version__,
        'method':'mj_kinematics: every key, support boundary and 50 Hz sampling; native collision-foot bounds',
        'physicsSteps':0,'scope':'Geometric contact and range checks only; not dynamics, balance, learned skill or hardware safety.', 'results':results}
(out/'kinematic-verification.json').write_text(json.dumps(report,indent=2)+'\n')
