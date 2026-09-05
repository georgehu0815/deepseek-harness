"""Authored references and immutable session projects; never a hardware controller."""
from __future__ import annotations

import contextlib
import fcntl
import json
import math
import os
import re
import stat
import uuid
from datetime import datetime


TEMPLATES = (
    ("head-bob", "Head Bob", "Gentle neck and head pulses on the beat."),
    ("disco-groove", "Disco Groove", "Small alternating hip turns with a head bob."),
    ("side-sway", "Side Sway", "Slow lateral hip and head sway."),
    ("robot-pop", "Robot Pop", "Smooth, short head accents with deliberate pauses."),
    ("tiny-march", "Tiny March", "Experimental alternating leg lifts; balance is not established."),
    ("celebration-mix", "Celebration Mix", "A repeating blend of bob, sway, and small turns."),
    ("stand", "Stand Steady", "Hold the model's standing keyframe."),
    ("hello", "Say Hello", "Small friendly nods and head tilts."),
    ("look-around", "Look Around", "Slow head turns from side to side."),
)


TEMPLATE_METADATA = {
    "head-bob": {"category": "dance", "difficulty": "starter", "behaviorId": "imitate", "trainingWeights": {"travel": 0}},
    "disco-groove": {"category": "dance", "difficulty": "intermediate", "behaviorId": "imitate", "trainingWeights": {"travel": 0}},
    "side-sway": {"category": "dance", "difficulty": "starter", "behaviorId": "imitate", "trainingWeights": {"travel": 0}},
    "robot-pop": {"category": "dance", "difficulty": "intermediate", "behaviorId": "imitate", "trainingWeights": {"travel": 0}},
    "tiny-march": {"category": "dance", "difficulty": "advanced", "behaviorId": "imitate", "trainingWeights": {"travel": 0}},
    "celebration-mix": {"category": "dance", "difficulty": "intermediate", "behaviorId": "imitate", "trainingWeights": {"travel": 0}},
    "stand": {"category": "action", "difficulty": "starter", "behaviorId": "stand", "trainingWeights": {}},
    "hello": {"category": "action", "difficulty": "starter", "behaviorId": "imitate", "trainingWeights": {"travel": 0}},
    "look-around": {"category": "action", "difficulty": "starter", "behaviorId": "imitate", "trainingWeights": {"travel": 0}},
}


def fields(value, expected, label):
    if not isinstance(value, dict) or set(value) != set(expected.split()):
        raise ValueError(f"{label} has missing or unsupported fields")


def strict_json(raw):
    """Reject duplicate object fields and non-JSON floating-point constants."""
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate project JSON field")
            result[key] = value
        return result

    def constant(value):
        raise ValueError("non-finite project JSON constant: " + value)

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def identity(value, prefix):
    if not isinstance(value, str) or not value.startswith(prefix + "-"):
        raise ValueError(f"invalid {prefix} identity")
    try:
        parsed = uuid.UUID(value[len(prefix) + 1:])
    except ValueError as exc:
        raise ValueError(f"invalid {prefix} identity") from exc
    if value != prefix + "-" + str(parsed):
        raise ValueError(f"invalid {prefix} identity")
    return value


def model_layout(model):
    """Resolve clip order, free root, and actuator transmission from the model."""
    import mujoco
    import numpy as np
    from microduck_local import contract as C
    joints = [model.joint(name) for name in C.JOINT_NAMES]
    if len(joints) != 14 or any(int(j.type[0]) != int(mujoco.mjtJoint.mjJNT_HINGE) for j in joints):
        raise ValueError("MicroDuck requires fourteen ordered hinge joints")
    roots = np.flatnonzero(model.jnt_type == mujoco.mjtJoint.mjJNT_FREE)
    if len(roots) != 1:
        raise ValueError("MicroDuck requires one free root joint")
    root_joint = int(roots[0])
    root_body = int(model.jnt_bodyid[root_joint])
    actuators = []
    for joint in joints:
        matches = [i for i in range(model.nu)
                   if int(model.actuator_trntype[i]) == int(mujoco.mjtTrn.mjTRN_JOINT)
                   and int(model.actuator_trnid[i, 0]) == joint.id]
        if len(matches) != 1:
            raise ValueError("MicroDuck requires one actuator per clip joint")
        actuators.append(matches[0])
    return {"joints": joints, "qpos": np.array([int(j.qposadr[0]) for j in joints]),
            "qvel": np.array([int(j.dofadr[0]) for j in joints]), "actuators": actuators,
            "rootBody": root_body, "rootJoint": root_joint}


def telemetry(model, data, layout, reference=False):
    """Return known FK pose or actual simulation measurements, never inferred reference velocities."""
    import mujoco
    import numpy as np
    root = layout["rootBody"]
    # mj_step integrates qpos after its position/velocity stages. Refresh only
    # kinematics, not dynamics or solver state, for the recorded post-step pose.
    mujoco.mj_kinematics(model, data)
    pose = {"jointPosition": data.qpos[layout["qpos"]].tolist(), "rootBody": model.body(root).name,
            "rootTilt": float(math.acos(float(np.clip(data.xmat[root, 8], -1, 1))))}
    if reference:
        return {**pose, "jointVelocity": None, "controllerTarget": None, "actuatorTorque": None,
                "rootLinearVelocityWorld": None, "rootSpeed": None}
    mujoco.mj_comPos(model, data)
    mujoco.mj_comVel(model, data)
    velocity = np.zeros(6)
    mujoco.mj_objectVelocity(model, data, mujoco.mjtObj.mjOBJ_BODY, root, velocity, 0)
    linear = velocity[3:]
    qvel = layout["qvel"]
    # BAM applies generalized joint torque and neutralizes the XML actuators.
    # XML-only simulation contributes through qfrc_actuator instead.
    torque = data.qfrc_applied[qvel] + data.qfrc_actuator[qvel]
    return {**pose, "jointVelocity": data.qvel[qvel].tolist(),
            "controllerTarget": data.ctrl[layout["actuators"]].tolist(), "actuatorTorque": torque.tolist(),
            "rootLinearVelocityWorld": linear.tolist(), "rootSpeed": float(np.linalg.norm(linear))}


class Studio:
    def __init__(self, bridge):
        self.bridge = bridge
        from bridge import number
        self.number = bridge_number = number
        self._model = None
        limits = bridge.limits
        required = {"minStudioBpm", "maxStudioBpm", "studioBeatChoices", "studioBlockBeatChoices", "maxProjectBlocks", "maxProjects", "maxClipSeconds", "maxClipKeys"}
        if not required <= limits.keys():
            raise ValueError("studio requires explicitly resolved limits: " + ", ".join(sorted(required - limits.keys())))
        self.limits = {"minBpm": bridge_number(limits["minStudioBpm"], "minimum BPM", 1, 9007199254740991, True),
                       "maxBpm": bridge_number(limits["maxStudioBpm"], "maximum BPM", 1, 9007199254740991, True),
                       "beatChoices": limits["studioBeatChoices"], "blockBeatChoices": limits["studioBlockBeatChoices"],
                       "maxProjectBlocks": bridge_number(limits["maxProjectBlocks"], "maximum project blocks", 1, 9007199254740991, True),
                       "maxClipSeconds": limits["maxClipSeconds"], "maxClipKeys": limits["maxClipKeys"]}
        if self.limits["minBpm"] > self.limits["maxBpm"]:
            raise ValueError("studio BPM limits are reversed")
        for key in ("beatChoices", "blockBeatChoices"):
            choices = self.limits[key]
            if not isinstance(choices, list) or not choices or len(choices) != len(set(choices)):
                raise ValueError("studio beat choices must be a nonempty unique list")
            for value in choices:
                bridge_number(value, "studio beats", 1, 9007199254740991, True)
        bridge_number(self.limits["maxClipKeys"], "maximum clip keys", 2, 100000, True)
        bridge_number(self.limits["maxClipSeconds"], "maximum clip seconds", 0.02, 100000)
        self.max_projects = bridge_number(limits["maxProjects"], "maximum project revisions", 1, 9007199254740991, True)

    def model(self):
        if self._model is None:
            import mujoco
            from microduck_local import contract as C
            self._model = mujoco.MjModel.from_xml_path(str(C.SCENE_WALK_XML))
        return self._model

    def profile(self):
        import mujoco
        import numpy as np
        model = self.model()
        layout = model_layout(model)
        stand = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_KEY, "STAND")
        if stand < 0:
            raise ValueError("MicroDuck model is missing its STAND keyframe")
        data = mujoco.MjData(model)
        mujoco.mj_resetDataKeyframe(model, data, stand)
        joints = []
        for joint in layout["joints"]:
            lower, upper = map(float, joint.range)
            default = float(data.qpos[int(joint.qposadr[0])])
            if not joint.limited[0] or not lower <= default <= upper:
                raise ValueError("model standing pose must lie within finite joint limits")
            joints.append({"name": joint.name, "index": int(joint.id), "lower": lower,
                           "upper": upper, "defaultPosition": default, "unit": "rad"})
        buffer = np.empty(mujoco.mj_sizeModel(model), dtype=np.uint8)
        mujoco.mj_saveModel(model, buffer=buffer)
        import hashlib
        return {"id": "microduck", "label": "MicroDuck", "modelSha256": hashlib.sha256(buffer.tobytes()).hexdigest(),
                "rootBody": {"name": model.body(layout["rootBody"]).name, "index": layout["rootBody"]},
                "joints": joints, "hardwareAvailable": False}

    def validate_clip_targets(self, clip, profile):
        """Check every structurally validated target against the loaded MJCF ranges."""
        for key in clip["keys"]:
            for target, joint in zip(key["joints"], profile["joints"], strict=True):
                self.number(target, "clip target " + joint["name"], joint["lower"], joint["upper"])

    def templates(self):
        bpm = min(max(96, self.limits["minBpm"]), self.limits["maxBpm"])
        beats = 32 if 32 in self.limits["beatChoices"] else self.limits["beatChoices"][0]
        return [{"id": key, "version": 1, "label": label, "description": description,
                 "experimental": True, **TEMPLATE_METADATA[key],
                 "trainingWeights": dict(TEMPLATE_METADATA[key]["trainingWeights"]),
                 "defaultParameters": {"bpm": bpm, "beats": beats, "moveSize": 0.5}}
                for key, label, description in TEMPLATES]

    def catalog(self):
        return {"profiles": [self.profile()], "templates": self.templates(), "limits": self.limits}

    def validate_recipe(self, recipe):
        expected = "projectId name profileId templateId templateVersion parameters music"
        if isinstance(recipe, dict) and "blocks" in recipe:
            expected += " blocks"
        fields(recipe, expected, "project recipe")
        if recipe["projectId"] is not None:
            identity(recipe["projectId"], "project")
        from bridge import validate_display_name
        validate_display_name(recipe["name"])
        if recipe["profileId"] != "microduck" or recipe["templateId"] not in {t[0] for t in TEMPLATES}:
            raise ValueError("unknown studio profile or template")
        if type(recipe["templateVersion"]) is not int or recipe["templateVersion"] != 1:
            raise ValueError("unsupported template version")
        parameters = recipe["parameters"]
        fields(parameters, "bpm beats moveSize", "studio parameters")
        self.number(parameters["bpm"], "BPM", self.limits["minBpm"], self.limits["maxBpm"])
        self.number(parameters["beats"], "beats", 1, 9007199254740991, True)
        if "blocks" not in recipe and parameters["beats"] not in self.limits["beatChoices"]:
            raise ValueError("unsupported studio beat count")
        self.number(parameters["moveSize"], "move size", 0, 1)
        if "blocks" in recipe:
            blocks = recipe["blocks"]
            if not isinstance(blocks, list) or not 1 <= len(blocks) <= self.limits["maxProjectBlocks"]:
                raise ValueError("project requires a bounded nonempty block list")
            for block in blocks:
                fields(block, "templateId templateVersion beats moveSize", "motion block")
                if (not isinstance(block["templateId"], str) or block["templateId"] not in TEMPLATE_METADATA
                        or type(block["templateVersion"]) is not int or block["templateVersion"] != 1):
                    raise ValueError("unknown motion block template or version")
                self.number(block["beats"], "block beats", 1, 9007199254740991, True)
                if block["beats"] not in self.limits["blockBeatChoices"]:
                    raise ValueError("unsupported motion block beat count")
                self.number(block["moveSize"], "block move size", 0, 1)
            if (blocks[0]["templateId"] != recipe["templateId"]
                    or blocks[0]["templateVersion"] != recipe["templateVersion"]):
                raise ValueError("first motion block must match the top-level template")
            if sum(block["beats"] for block in blocks) != parameters["beats"]:
                raise ValueError("motion block beats must sum to project and music beats")
        music = recipe["music"]
        fields(music, "version style bpm beats seed", "music recipe")
        if type(music["version"]) is not int or music["version"] != 1 or music["style"] not in ("disco", "electronic", "lofi", "chiptune"):
            raise ValueError("unsupported music recipe")
        self.number(music["bpm"], "music BPM", self.limits["minBpm"], self.limits["maxBpm"])
        self.number(music["beats"], "music beats", 1, 9007199254740991, True)
        self.number(music["seed"], "music seed", 0, 2147483647, True)
        if music["bpm"] != parameters["bpm"] or music["beats"] != parameters["beats"]:
            raise ValueError("music and motion must have the same BPM and beats")
        duration = 60 * parameters["beats"] / parameters["bpm"]
        self.number(duration, "compiled clip duration", 0.02, self.limits["maxClipSeconds"])
        if parameters["beats"] * 8 + 1 > self.limits["maxClipKeys"]:
            raise ValueError("compiled reference requires more keys than maxClipKeys permits")

    def _effective_blocks(self, recipe):
        parameters = recipe["parameters"]
        if "blocks" not in recipe:
            return [{"templateId": recipe["templateId"], "templateVersion": recipe["templateVersion"],
                     "beats": parameters["beats"], "moveSize": parameters["moveSize"]}]
        return [{**block, "moveSize": block["moveSize"] * parameters["moveSize"]} for block in recipe["blocks"]]

    def resolved_blocks(self, recipe):
        templates = {template["id"]: template for template in self.templates()}
        return [{"template": json.loads(json.dumps(templates[block["templateId"]])),
                 "beats": block["beats"], "moveSize": block["moveSize"]} for block in self._effective_blocks(recipe)]

    def training(self, blocks):
        """Resolve whole-motion recommendations without changing an explicit training request."""
        behavior = "stand" if all(block["template"]["behaviorId"] == "stand" for block in blocks) else "imitate"
        weights = {}
        for block in blocks:
            for key, value in block["template"]["trainingWeights"].items():
                if key in weights and weights[key] != value:
                    raise ValueError("motion blocks have conflicting curated training weights")
                weights[key] = value
        return {"behaviorId": behavior, "weights": weights}

    def compile(self, recipe, profile):
        self.validate_recipe(recipe)
        parameters = recipe["parameters"]
        keys, elapsed_beats = [], 0
        for block in self._effective_blocks(recipe):
            block_keys = self._compile_block(block, parameters["bpm"], profile)
            offset = 60 * elapsed_beats / parameters["bpm"]
            keys.extend({**key, "t": offset + key["t"]} for key in (block_keys if not keys else block_keys[1:]))
            elapsed_beats += block["beats"]
        duration = 60 * parameters["beats"] / parameters["bpm"]
        keys[-1]["t"] = duration
        self.validate_clip_targets({"keys": keys}, profile)
        return {"version": 1, "name": recipe["name"],
                "duration": duration, "loop": True, "keys": keys}

    def _compile_block(self, block, bpm, profile):
        beats = block["beats"]
        duration = 60 * beats / bpm
        # Eight samples per beat prevent sparse-key aliasing from erasing authored pulses.
        count = int(beats * 8) + 1
        keys = []
        joint_names = {joint["name"] for joint in profile["joints"]}
        for i in range(count):
            beat = beats * i / (count - 1)
            wave = math.sin(2 * math.pi * beat)
            sway = math.sin(math.pi * beat / 2)
            turn = math.sin(math.pi * beat / 4)
            envelope = math.sin(math.pi * i / (count - 1)) ** 2
            size = block["moveSize"] * envelope
            motion = block["templateId"]
            delta = {}
            if motion in ("head-bob", "disco-groove", "celebration-mix", "hello"):
                delta.update(neck_pitch=0.12 * wave, head_pitch=-0.18 * wave)
            if motion in ("side-sway", "disco-groove", "celebration-mix"):
                delta.update(left_hip_roll=0.06 * sway, right_hip_roll=0.06 * sway, head_roll=-0.12 * sway)
            if motion in ("disco-groove", "celebration-mix"):
                delta.update(left_hip_yaw=0.08 * turn, right_hip_yaw=0.08 * turn)
            if motion == "robot-pop":
                delta.update(head_pitch=0.2 * wave ** 5, head_yaw=0.15 * sway ** 5)
            if motion == "tiny-march":
                left, right = max(wave, 0) ** 2, max(-wave, 0) ** 2
                delta.update(left_hip_pitch=-0.1 * left, left_knee=0.18 * left, left_ankle=-0.08 * left,
                             right_hip_pitch=0.1 * right, right_knee=-0.18 * right, right_ankle=0.08 * right)
            if motion in ("look-around", "hello", "celebration-mix"):
                delta["head_yaw"] = 0.35 * turn
            if motion == "hello":
                delta["head_roll"] = 0.12 * sway
            if delta.keys() - joint_names:
                raise ValueError("template references missing model joints: " + ", ".join(sorted(delta.keys() - joint_names)))
            positions = [max(j["lower"], min(j["upper"], j["defaultPosition"] + size * delta.get(j["name"], 0)))
                         for j in profile["joints"]]
            keys.append({"t": duration * i / (count - 1), "joints": positions, "rootPitch": 0.0})
        keys[-1] = {"t": duration, "joints": keys[0]["joints"][:], "rootPitch": 0.0}
        return keys

    @contextlib.contextmanager
    def directory(self, create=False):
        """Hold a no-follow directory descriptor for all project file operations."""
        if create:
            self.bridge.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        root_fd = os.open(self.bridge.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            if create:
                try:
                    os.mkdir("projects", mode=0o700, dir_fd=root_fd)
                except FileExistsError:
                    pass  # The no-follow directory open below verifies the existing entry.
            fd = os.open("projects", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
            try:
                yield fd
            finally:
                os.close(fd)
        finally:
            os.close(root_fd)

    def validate_template(self, template, template_id):
        fields(template, "id version label description experimental category difficulty behaviorId trainingWeights defaultParameters", "project template")
        if (template["id"] != template_id or type(template["version"]) is not int
                or template["version"] != 1 or template["experimental"] is not True
                or not isinstance(template["label"], str) or not isinstance(template["description"], str)):
            raise ValueError("invalid project template")
        if not isinstance(template["trainingWeights"], dict):
            raise ValueError("template training weights must be a reward-keyed object")
        for weight in template["trainingWeights"].values():
            self.number(weight, "template training weight", 0, self.bridge.limits["maxRewardWeight"])
        if any(template[key] != value for key, value in TEMPLATE_METADATA[template_id].items()):
            raise ValueError("project template metadata differs from its registered version")
        fields(template["defaultParameters"], "bpm beats moveSize", "template defaults")
        for key, low, high in (("bpm", 1, 9007199254740991), ("beats", 1, 9007199254740991), ("moveSize", 0, 1)):
            self.number(template["defaultParameters"][key], key, low, high, key == "beats")

    def validate_project(self, project):
        if not isinstance(project, dict) or type(project.get("version")) is not int or project["version"] != 2:
            raise ValueError("unsupported project version; expected 2")
        fields(project, "version id projectId createdAt recipe profile template blocks training clip sha256", "project revision")
        identity(project["id"], "revision")
        identity(project["projectId"], "project")
        if not isinstance(project["createdAt"], str) or datetime.fromisoformat(project["createdAt"]).tzinfo is None:
            raise ValueError("project creation time requires a timezone")
        from bridge import digest, validate_clip
        if digest({k: v for k, v in project.items() if k != "sha256"}) != project["sha256"]:
            raise ValueError("project content hash mismatch")
        self.validate_recipe(project["recipe"])
        if project["recipe"]["projectId"] not in (None, project["projectId"]):
            raise ValueError("project recipe identity mismatch")
        profile = project["profile"]
        fields(profile, "id label modelSha256 rootBody joints hardwareAvailable", "project profile")
        if profile["id"] != "microduck" or profile["hardwareAvailable"] is not False or not isinstance(profile["label"], str):
            raise ValueError("invalid project profile")
        if not isinstance(profile["modelSha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", profile["modelSha256"]):
            raise ValueError("invalid model hash")
        fields(profile["rootBody"], "name index", "root body")
        if not isinstance(profile["rootBody"]["name"], str) or not profile["rootBody"]["name"]:
            raise ValueError("invalid root body name")
        self.number(profile["rootBody"]["index"], "root body index", 1, 2147483647, True)
        if not isinstance(profile["joints"], list) or len(profile["joints"]) != 14:
            raise ValueError("project profile requires fourteen joints")
        names, indices = set(), set()
        for joint in profile["joints"]:
            fields(joint, "name index lower upper defaultPosition unit", "profile joint")
            if not isinstance(joint["name"], str) or not joint["name"] or joint["unit"] != "rad":
                raise ValueError("invalid profile joint")
            self.number(joint["index"], "joint index", 0, 2147483647, True)
            self.number(joint["lower"], "joint lower limit", -math.pi, math.pi)
            self.number(joint["upper"], "joint upper limit", joint["lower"], math.pi)
            self.number(joint["defaultPosition"], "joint default", joint["lower"], joint["upper"])
            names.add(joint["name"])
            indices.add(joint["index"])
        if len(names) != 14 or len(indices) != 14:
            raise ValueError("duplicate profile joint")
        self.validate_template(project["template"], project["recipe"]["templateId"])
        blocks = project["blocks"]
        expected = self._effective_blocks(project["recipe"])
        if not isinstance(blocks, list) or len(blocks) != len(expected) or len(blocks) > self.limits["maxProjectBlocks"]:
            raise ValueError("frozen project blocks differ from recipe")
        for block, effective in zip(blocks, expected, strict=True):
            fields(block, "template beats moveSize", "frozen motion block")
            self.validate_template(block["template"], effective["templateId"])
            self.number(block["beats"], "frozen block beats", 1, 9007199254740991, True)
            self.number(block["moveSize"], "frozen block move size", 0, 1)
            if block["beats"] != effective["beats"] or block["moveSize"] != effective["moveSize"]:
                raise ValueError("frozen block parameters differ from recipe")
        if project["template"] != blocks[0]["template"]:
            raise ValueError("project template differs from its first block")
        training = project["training"]
        fields(training, "behaviorId weights", "resolved project training")
        if not isinstance(training["weights"], dict):
            raise ValueError("resolved training weights must be an object")
        for weight in training["weights"].values():
            self.number(weight, "resolved training weight", 0, self.bridge.limits["maxRewardWeight"])
        if training != self.training(blocks):
            raise ValueError("resolved project training differs from frozen blocks")
        validate_clip(project["clip"], self.bridge.limits)
        if project["clip"] != self.compile(project["recipe"], profile):
            raise ValueError("project clip differs from frozen recipe")
        return project

    def read_project(self, fd, filename):
        identity(filename.removesuffix(".json"), "revision")
        handle = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        with os.fdopen(handle, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise ValueError("project revision must be a regular file")
            # Fourteen doubles plus wrapper metadata; bound the entire serialized record.
            limit = 65536 + int(self.limits["maxClipKeys"]) * 1024
            raw = stream.read(limit + 1)
        if len(raw) > limit:
            raise ValueError("project revision exceeds file size limit")
        project = self.validate_project(strict_json(raw))
        if project["id"] + ".json" != filename:
            raise ValueError("project filename identity mismatch")
        return project

    def projects(self):
        with contextlib.ExitStack() as stack:
            try:
                fd = stack.enter_context(self.directory())
            except FileNotFoundError:
                return []
            return self._projects(fd)

    def _projects(self, fd):
        names = sorted(name for name in os.listdir(fd) if name.endswith(".json"))
        if len(names) > self.max_projects:
            raise ValueError("project revision count exceeds configured maximum")
        return sorted((self.read_project(fd, name) for name in names), key=lambda p: (p["createdAt"], p["id"]))

    def project(self, revision_id):
        identity(revision_id, "revision")
        with self.directory() as fd:
            return self.read_project(fd, revision_id + ".json")

    def save(self, recipe):
        from bridge import digest, now
        recipe = json.loads(json.dumps(recipe, allow_nan=False))
        self.validate_recipe(recipe)
        profile = self.profile()
        blocks = self.resolved_blocks(recipe)
        project = {"version": 2, "id": "revision-" + str(uuid.uuid4()),
                   "projectId": recipe["projectId"] or "project-" + str(uuid.uuid4()), "createdAt": now(),
                   "recipe": recipe, "profile": profile,
                   "template": blocks[0]["template"], "blocks": blocks, "training": self.training(blocks),
                   "clip": self.compile(recipe, profile)}
        project["sha256"] = digest(project)
        self.validate_project(project)
        with self.directory(create=True) as fd:
            fcntl.flock(fd, fcntl.LOCK_EX)
            saved = self._projects(fd)
            if len(saved) >= self.max_projects:
                raise ValueError("maximum project revisions reached")
            if recipe["projectId"] is not None and not any(p["projectId"] == recipe["projectId"] for p in saved):
                raise ValueError("unknown project identity in this session")
            temporary = ".revision-" + str(uuid.uuid4()) + ".tmp"
            handle = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=fd)
            try:
                with os.fdopen(handle, "w") as stream:
                    json.dump(project, stream, allow_nan=False, separators=(",", ":"))
                    stream.write("\n")
                    stream.flush()
                    os.fsync(stream.fileno())
                os.link(temporary, project["id"] + ".json", src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
                os.fsync(fd)
            finally:
                os.unlink(temporary, dir_fd=fd)
        return project

    def preview(self, revision_id):
        frame_cap = self.number(self.bridge.limits["maxSimulationSteps"], "reference frame cap", 0, 100000, True)
        if frame_cap < 2:
            raise ValueError("reference_preview requires maxSimulationSteps >= 2 to include zero and duration endpoints")
        import mujoco
        import numpy as np
        project = self.project(revision_id)
        if project["profile"] != self.profile():
            raise ValueError("installed model differs from project profile")
        model = self.model()
        layout = model_layout(model)
        data = mujoco.MjData(model)
        mujoco.mj_resetDataKeyframe(model, data, model.key("STAND").id)
        clip = project["clip"]
        count = min(int(math.ceil(clip["duration"] * 50)) + 1, frame_cap)
        times = np.linspace(0, clip["duration"], count)
        key_times = [k["t"] for k in clip["keys"]]
        positions = np.asarray([k["joints"] for k in clip["keys"]])
        root_qpos = int(model.jnt_qposadr[layout["rootJoint"]])
        frames = []
        for t in times:
            data.qpos[layout["qpos"]] = [np.interp(t, key_times, positions[:, j]) for j in range(14)]
            pitch = float(np.interp(t, key_times, [k["rootPitch"] for k in clip["keys"]]))
            data.qpos[root_qpos + 3:root_qpos + 7] = [math.cos(pitch / 2), 0, math.sin(pitch / 2), 0]
            data.qvel[:] = 0
            data.time = float(t)
            mujoco.mj_forward(model, data)
            frames.append({"step": int(round(float(t) * 50)), "time": float(t),
                           "bodies": np.column_stack((data.xpos, data.xquat)).tolist(), "reward": 0.0,
                           "terminated": False, "telemetry": telemetry(model, data, layout, reference=True)})
        return {"mode": "kinematic-reference", "projectRevisionId": project["id"], "projectSha256": project["sha256"],
                "controlHz": 50, "frames": frames,
                "limitations": ["Kinematic MuJoCo forward poses, not learned-policy execution or dynamic simulation.",
                                "Reference velocities, speed, controller targets and actuator torque are not measured and are null.",
                                "Reference frames may be downsampled to the configured frame limit.",
                                "Balance, contact feasibility, and hardware safety are not established."]}
