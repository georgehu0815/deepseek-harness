"""Export the installed MuJoCo body tree for native, non-physical pose authoring."""


def scene_kinematics(model, joint_names):
    """Read body-local rest transforms, hinge references, and the STAND root position."""
    import mujoco

    free = [j for j in range(model.njnt) if model.jnt_type[j] == mujoco.mjtJoint.mjJNT_FREE]
    hinges = [model.joint(name).id for name in joint_names]
    if (len(free) != 1 or len(set(hinges)) != 14 or model.njnt != 15
            or any(model.jnt_type[j] != mujoco.mjtJoint.mjJNT_HINGE for j in hinges)):
        raise ValueError("Native pose authoring requires one free root and fourteen named hinges")
    root = free[0]
    root_body = int(model.jnt_bodyid[root])
    if model.body_parentid[root_body] != 0:
        raise ValueError("Native pose authoring requires a world-parented free root")
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
    root_adr = int(model.jnt_qposadr[root])
    return {
        "rootBody": root_body,
        "rootPosition": data.qpos[root_adr:root_adr + 3].tolist(),
        "bodies": [{"parent": int(model.body_parentid[b]),
                    "pos": model.body_pos[b].tolist(), "quat": model.body_quat[b].tolist()}
                   for b in range(model.nbody)],
        "joints": [{"body": int(model.jnt_bodyid[j]), "pos": model.jnt_pos[j].tolist(),
                    "axis": model.jnt_axis[j].tolist(),
                    "reference": float(model.qpos0[model.jnt_qposadr[j]])}
                   for j in hinges],
    }
