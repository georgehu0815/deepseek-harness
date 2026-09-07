"""Confined, JSON-only adapter over an installed MicroDuck Lab checkout.

The host owns subprocess lifetime. This bridge never downloads dependencies,
starts a web server, loads uploaded pickle files, or activates hardware.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import subprocess
from pathlib import Path
import re
import sys
import traceback
import tempfile
import uuid
import unicodedata
from datetime import datetime, timezone

STANDARD = "microduck-standard-61"
PHASE = "microduck-lab-body-phase-61"
ID = re.compile(r"^run-[a-f0-9-]{36}$")
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$")
DEPLOY_REASON = "Local Lab policies are simulation prototypes; official retraining and target-runtime validation are required."
DEPENDENCIES = ("mujoco", "stable_baselines3", "onnxruntime", "onnx", "numpy", "torch")


def dependency_versions():
    return {name: importlib.metadata.version(name) for name in DEPENDENCIES}


def runtime_versions():
    return {name: importlib.metadata.version(name) for name in ("mujoco", "onnxruntime", "numpy", "numba")}


def mlx_probe():
    """Probe Metal in a child so later CPU worker forks inherit no GPU runtime."""
    if platform.system() != "Darwin" or platform.machine() != "arm64" or sys.version_info[:2] != (3, 12):
        raise ValueError("MLX GPU requires macOS arm64 and Python 3.12")
    code = ("import json,mlx.core as mx; "
            "assert mx.metal.is_available(), 'Metal GPU is unavailable'; "
            "mx.set_default_device(mx.gpu); x=mx.array([1.0])+1; mx.eval(x); "
            "assert x.item()==2.0; print(json.dumps(mx.device_info()))")
    probe = subprocess.run([sys.executable, "-B", "-c", code], capture_output=True, text=True, timeout=30, check=False)
    if probe.returncode != 0:
        raise ValueError("MLX GPU probe failed: " + probe.stderr[-4096:])
    return json.loads(probe.stdout)["device_name"]


def trainer_provenance(spec, limits=None):
    backend = spec["backend"]
    versions = dependency_versions()
    versions.update({name: importlib.metadata.version(name) for name in ("gymnasium", "cloudpickle", "numba")})
    helpers = {}
    if backend == "rlx":
        if limits is None:
            raise ValueError("RLX requires configured source and PPO limits")
        from rlx_ppo import recipe, probe
        settings = recipe(spec, limits)
        versions.update({name: importlib.metadata.version(name) for name in ("mlx", "mlx-metal", "rlx")})
        helpers["rlx_ppo.py"] = file_hash(Path(__file__).with_name("rlx_ppo.py"))
        hardware = probe(limits.get("rlxSourceRoot"))
    elif backend == "mlx":
        versions.update({name: importlib.metadata.version(name) for name in ("mlx", "mlx-metal")})
        from mlx_ppo import recipe
        settings = recipe(spec)
        helpers["mlx_ppo.py"] = file_hash(Path(__file__).with_name("mlx_ppo.py"))
        hardware = mlx_probe()
    else:
        from microduck_local import train_behavior as trainer
        from microduck_local.behaviors import BEHAVIORS
        from microduck_local.ppo_hparams import N_STEPS, ppo_batch_size
        settings = {"version": "microduck-sb3-cpu-v1", "horizon": N_STEPS,
                    "batchSize": ppo_batch_size(N_STEPS, spec["envs"]), "epochs": 5,
                    "learningRateStart": trainer.LR_START, "learningRateEnd": trainer.LR_END,
                    "symmetryCoefficient": 0.0 if spec["clip"] else trainer.symmetry_coef_for(BEHAVIORS[spec["behaviorId"]], None),
                    "actionSemantics": "gaussian-preclip-training-raw-mean-export-v1",
                    "normalization": {"observations": True, "rewards": False, "clip": 100.0, "epsilon": 1e-8}}
        hardware = platform.machine()
    value = {"backend": backend, "learnerDevice": "metal" if backend in ("mlx", "rlx") else "cpu",
             "physicsDevice": "cpu", "pythonVersion": platform.python_version(),
             "platform": platform.system(), "architecture": platform.machine(), "hardware": hardware,
             "dependencyVersions": versions, "helperSha256": helpers, "recipe": settings}
    return {**value, "sha256": digest(value)}


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def bridge_hash():
    """Fingerprint simulation, reference, and evaluator code without importing learners."""
    return digest({name: file_hash(Path(__file__).with_name(name)) for name in ("bridge.py", "studio.py", "dance_metrics.py")})


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, indent=2, allow_nan=False) + "\n"
    fd, name = tempfile.mkstemp(prefix="." + path.name + "-", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def bam_provenance():
    from microduck_local.bam_actuator import load_bam_params
    parameters, source = load_bam_params()
    value = {"source": source, "parameters": dict(parameters)}
    return {**value, "sha256": digest(value)}


def verify_bam(frozen):
    if not isinstance(frozen, dict) or set(frozen) != {"source", "parameters", "sha256"}:
        raise ValueError("missing frozen BAM provenance")
    if digest({"source": frozen["source"], "parameters": frozen["parameters"]}) != frozen["sha256"]:
        raise ValueError("frozen BAM hash mismatch")
    if bam_provenance() != frozen:
        raise ValueError("effective BAM parameters or source differ from frozen provenance")


@contextlib.contextmanager
def frozen_bam(frozen):
    """Pin construction to verified values; never reopen optional installed BAM data.

    Each bridge operation owns a process. Trainer workers inherit this scope or
    enter it from their serialized environment factory, never another request.
    """
    from microduck_local import bam_actuator
    original = bam_actuator.load_bam_params
    bam_actuator.load_bam_params = lambda: (dict(frozen["parameters"]), frozen["source"])
    try:
        yield
    finally:
        bam_actuator.load_bam_params = original


def bam_settings(env):
    actuator = env.bam
    return {"kpFw": actuator.kp_fw, "maxCurrent": actuator.max_current,
            "maxPwm": actuator.max_pwm, "vinNominal": actuator.vin_nominal,
            "vinDropGain": actuator.vin_drop_gain, "vinMin": actuator.vin_min,
            "frictionScale": actuator.friction_scale,
            "delayMinLag": actuator._delay.min_lag if actuator._delay else 0,
            "delayMaxLag": actuator._delay.max_lag if actuator._delay else 0}


def number(value, label, minimum, maximum, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    if not minimum <= value <= maximum or (integer and value != int(value)):
        raise ValueError(f"{label} must be {'an integer ' if integer else ''}between {minimum} and {maximum}")
    return int(value) if integer else float(value)


def validate_display_name(value):
    """Preserve bounded Unicode display text; it never selects a filesystem path."""
    if (not isinstance(value, str) or not value.strip() or len(value) > 64
            or any(unicodedata.category(character) in ("Cc", "Cs") for character in value)):
        raise ValueError("display name must be nonblank and at most 64 Unicode characters without controls")


def validate_clip(clip, limits):
    if not isinstance(clip, dict) or set(clip) != {"version", "name", "duration", "loop", "keys"}:
        raise ValueError("clip requires exactly version, name, duration, loop, keys")
    if type(clip["version"]) is not int or clip["version"] != 1 or not isinstance(clip["loop"], bool):
        raise ValueError("invalid clip version or loop")
    validate_display_name(clip["name"])
    duration = number(clip["duration"], "clip duration", 0.02, limits["maxClipSeconds"])
    keys = clip["keys"]
    if not isinstance(keys, list) or not 2 <= len(keys) <= limits["maxClipKeys"]:
        raise ValueError("clip requires a bounded list of at least two keys")
    previous = -1.0
    for key in keys:
        if not isinstance(key, dict) or set(key) != {"t", "joints", "rootPitch"}:
            raise ValueError("clip keys require t, joints, rootPitch")
        t = number(key["t"], "key time", 0, duration)
        if t <= previous:
            raise ValueError("clip times must be strictly increasing")
        previous = t
        number(key["rootPitch"], "root pitch", -math.pi, math.pi)
        if not isinstance(key["joints"], list) or len(key["joints"]) != 14:
            raise ValueError("clip keys require fourteen joint targets")
        for joint in key["joints"]:
            number(joint, "joint target", -math.pi, math.pi)
    if keys[0]["t"] != 0 or keys[-1]["t"] != duration:
        raise ValueError("clip must include keys at zero and duration")
    if clip["loop"] and (keys[0]["joints"] != keys[-1]["joints"] or keys[0]["rootPitch"] != keys[-1]["rootPitch"]):
        raise ValueError("loop endpoints must match")


def validate_spec(spec, limits):
    required = {"name", "behaviorId", "steps", "envs", "seed", "actuator", "weights", "clip"}
    if not isinstance(spec, dict) or set(spec) - {"backend", "projectRevisionId"} != required:
        raise ValueError("training spec has missing or unsupported fields")
    spec = json.loads(json.dumps({**spec, "backend": spec.get("backend", "cpu")}, allow_nan=False))
    if "projectRevisionId" in spec:
        from studio import identity
        identity(spec["projectRevisionId"], "revision")
    if spec["backend"] not in ("cpu", "mlx", "rlx"):
        raise ValueError("training backend must be cpu, mlx, or rlx")
    if not isinstance(spec["name"], str) or not NAME.fullmatch(spec["name"]):
        raise ValueError("invalid training name")
    spec["steps"] = number(spec["steps"], "steps", 1, limits["maxTrainingSteps"], True)
    spec["envs"] = number(spec["envs"], "envs", 1, limits["maxEnvs"], True)
    spec["seed"] = number(spec["seed"], "seed", 0, 2147483647, True)
    if spec["actuator"] not in ("bam", "xml"):
        raise ValueError("actuator must be bam or xml")
    from microduck_local.behaviors import BEHAVIORS, CATALOG
    if spec["behaviorId"] not in BEHAVIORS:
        raise ValueError("unknown registered behavior")
    if not isinstance(spec["weights"], dict):
        raise ValueError("weights must be a catalog-keyed object")
    known = set(CATALOG) | {term.key for term in BEHAVIORS[spec["behaviorId"]].terms}
    for key, value in spec["weights"].items():
        if key not in known:
            raise ValueError(f"unknown reward term: {key}")
        number(value, "reward weight", 0, limits["maxRewardWeight"])
    if spec["clip"] is not None:
        validate_clip(spec["clip"], limits)
    elif BEHAVIORS[spec["behaviorId"]].clip_name and "projectRevisionId" not in spec:
        raise ValueError("clip behaviors require the complete explicit reference clip")
    return spec


class Bridge:
    def __init__(self, source, root, limits):
        self.source = source.resolve(strict=True)
        self.root = root.resolve()
        self.limits = limits
        package = self.source / "microduck_local/src"
        if not (package / "microduck_local/contract.py").is_file():
            raise ValueError("sourceRoot must be a MicroDuck Lab checkout")
        sys.path.insert(0, str(package))
        # Do not inherit experiment configuration from a shell or another run.
        for key in list(os.environ):
            if key.startswith("MICRODUCK_"):
                del os.environ[key]
        os.environ.update({
            "MICRODUCK_RL_DIR": str(self.source / "microduck_rl"),
            "MICRODUCK_RUNS_DIR": str(self.root / "runs"),
            "MICRODUCK_CLIPS_DIR": str(self.root / "clips"),
            "NUMBA_CACHE_DIR": str(self.root / "cache/numba"),
            "MPLCONFIGDIR": str(self.root / "cache/matplotlib"),
        })

    def path(self, run_id):
        if not isinstance(run_id, str) or not ID.fullmatch(run_id):
            raise ValueError("invalid run identity")
        path = (self.root / "runs" / run_id).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("run path escapes project storage")
        return path

    def fingerprint(self):
        h = hashlib.sha256()
        roots = [self.source / "microduck_local/src", self.source / "microduck_rl/src/mjlab_microduck/robot"]
        for root in roots:
            for path in sorted(root.rglob("*")):
                if path.is_file() and path.suffix.lower() in (".py", ".xml", ".stl", ".obj"):
                    h.update(str(path.relative_to(self.source)).encode())
                    h.update(bytes.fromhex(file_hash(path)))
        return h.hexdigest()

    def readiness(self, backend="cpu"):
        versions = {}
        available = {"available": True, "reason": None}
        try:
            versions = dependency_versions()
            from microduck_local import contract as C
            if not C.SCENE_WALK_XML.is_file():
                raise ValueError("official microduck_rl MJCF assets are missing")
            import mujoco
            mujoco.MjModel.from_xml_path(str(C.SCENE_WALK_XML))
        except Exception as exc:
            available = {"available": False, "reason": str(exc)}
        backends = {
            "cpu": {**available, "learnerDevice": "cpu", "physicsDevice": "cpu", "versions": versions},
            "mlx": {"available": False, "reason": "Configure mlxPythonBin with an isolated Python 3.12 MLX environment.",
                    "learnerDevice": "metal", "physicsDevice": "cpu", "versions": {}},
            "rlx": {"available": False, "reason": "Configure rlxPythonBin and rlxSourceRoot with an isolated Python 3.12 RLX environment.",
                    "learnerDevice": "metal", "physicsDevice": "cpu", "versions": {}},
        }
        if backend == "rlx":
            try:
                if not available["available"]:
                    raise ValueError(available["reason"])
                from rlx_ppo import probe
                rlx_versions = {**versions, **{name: importlib.metadata.version(name) for name in ("mlx", "mlx-metal", "rlx")}}
                probe(self.limits.get("rlxSourceRoot"))
                backends["rlx"].update(available=True, reason=None, versions=rlx_versions)
            except Exception as exc:
                backends["rlx"].update(reason=str(exc))
        if backend == "mlx":
            try:
                if not available["available"]:
                    raise ValueError(available["reason"])
                mlx_versions = {**versions, **{name: importlib.metadata.version(name) for name in ("mlx", "mlx-metal")}}
                mlx_probe()
                backends["mlx"].update(available=True, reason=None, versions=mlx_versions)
            except Exception as exc:
                backends["mlx"].update(reason=str(exc))
        return {"ready": available["available"], "reason": available["reason"], "versions": versions,
                "defaultBackend": "cpu", "backends": backends,
                "capabilities": {"train": available, "simulate": available, "evaluate": available,
                                 "deploy": {"available": False, "reason": DEPLOY_REASON}}}

    def behaviors(self):
        from microduck_local.behaviors import BEHAVIORS
        return [{"id": b.id, "label": b.title, "description": b.description, "defaultSteps": b.default_steps,
                 "terms": [{"key": t.key, "label": t.friendly, "weight": t.weight, "penalty": t.is_penalty} for t in b.terms]}
                for b in BEHAVIORS.values()]

    def scene(self):
        import mujoco
        from microduck_local.viz_server import extract_scene
        from microduck_local import contract as C
        from scene_kinematics import scene_kinematics
        scene = extract_scene()
        model = mujoco.MjModel.from_xml_path(str(C.SCENE_WALK_XML))
        scene.update(defaultJoints=C.DEFAULT_POSE.tolist(), jointNames=list(C.JOINT_NAMES),
                     kinematics=scene_kinematics(model, C.JOINT_NAMES))
        return scene

    def studio(self):
        from studio import Studio
        return Studio(self)

    def _validate_project_spec(self, spec):
        """Validate a project snapshot only after reading a hash-checked durable run."""
        from studio import Studio
        if "projectRevisionId" not in spec or "projectSnapshot" not in spec:
            raise ValueError("project-bound run requires a frozen project snapshot")
        validated = validate_spec({k: v for k, v in spec.items() if k != "projectSnapshot"}, self.limits)
        project = Studio(self).validate_project(spec["projectSnapshot"])
        if project["id"] != validated["projectRevisionId"] or project["clip"] != validated["clip"]:
            raise ValueError("frozen project differs from training reference")

    def run(self, run_id):
        path = self.path(run_id)
        run = json.loads((path / "manifest.json").read_text())
        if run.get("formatVersion") != 3:
            raise ValueError("unsupported Robot Lab run format; only version 3 is supported")
        if digest(run["spec"]) != run["recipeHash"]:
            raise ValueError("frozen recipe hash mismatch")
        if "dancePlan" in run:
            from dance_metrics import validate_plan_hash
            validate_plan_hash(run["dancePlan"], digest)
        if "projectRevisionId" in run["spec"] or "projectSnapshot" in run["spec"]:
            self._validate_project_spec(run["spec"])
        trainer = run["provenance"]["trainer"]
        if digest({k: v for k, v in trainer.items() if k != "sha256"}) != trainer["sha256"]:
            raise ValueError("frozen trainer provenance hash mismatch")
        backend = run["spec"]["backend"]
        if backend not in ("cpu", "mlx", "rlx") or trainer["backend"] != backend:
            raise ValueError("frozen trainer backend differs from recipe")
        device = "metal" if backend in ("mlx", "rlx") else "cpu"
        if (trainer["learnerDevice"] != device or trainer["physicsDevice"] != "cpu"
                or run["provenance"]["environment"]["updateDevice"] != device):
            raise ValueError("frozen trainer device differs from backend")
        expected_helpers = {"rlx_ppo.py"} if backend == "rlx" else {"mlx_ppo.py"} if backend == "mlx" else set()
        if set(trainer["helperSha256"]) != expected_helpers:
            raise ValueError("missing or unsupported learner helper provenance")
        progress = path / "progress.jsonl"
        if progress.exists():
            # Bound the read even when the experiment ran for days.
            with progress.open("rb") as f:
                f.seek(max(0, progress.stat().st_size - 65536))
                lines = f.read().splitlines()
            for line in reversed(lines):
                try:
                    value = json.loads(line)
                    run["progress"] = {"steps": value["steps"], "total": value["total"], "elapsedSeconds": value["elapsed_s"], "reward": value.get("ep_rew")}
                    if "rlx" in value:
                        run["progress"]["rlx"] = value["rlx"]
                    break
                except (ValueError, KeyError):
                    continue
        # Terminal state settled by the host after the process ended lives in a
        # sidecar, so the frozen manifest is never rewritten (a JS re-serialization
        # would drop integer-valued floats' ".0" and break the provenance hash).
        override = path / "state.json"
        if override.exists():
            settled = json.loads(override.read_text())
            run["state"], run["error"], run["finishedAt"] = settled["state"], settled.get("error"), settled.get("finishedAt")
        return run

    def list_runs(self):
        """Separate unsupported versions without interpreting or rewriting their metadata."""
        runs, incompatible = [], []
        for path in sorted((self.root / "runs").glob("run-*")):
            if not ID.fullmatch(path.name):
                continue
            manifest = self.path(path.name) / "manifest.json"
            if not manifest.is_file():
                continue
            version = json.loads(manifest.read_text()).get("formatVersion")
            if version != 3:
                incompatible.append({"id": path.name, "formatVersion": version if type(version) is int and abs(version) <= 9007199254740991 else None,
                                     "reason": "unsupported Robot Lab run format; only version 3 is supported"})
            else:
                runs.append(self.run(path.name))
        return {"runs": runs, "incompatibleRuns": incompatible}

    def runs(self):
        return self.list_runs()["runs"]

    def resolve_dance_plan(self, run, evaluation):
        """Resolve policy-independent scientific inputs before training admission commits."""
        from dance_metrics import validate_evaluation, reference_descriptor
        from microduck_local import contract as C
        from microduck_local.motion import load_clip, CONTROL_HZ
        evaluation = validate_evaluation(evaluation, self.limits)
        spec = run["spec"]
        if spec["clip"] is None:
            raise ValueError("dance evaluation requires an owned authored reference")
        if CONTROL_HZ != 1 / C.CTRL_DT:
            raise ValueError("reference and simulator control clocks differ")
        directory = self.path(run["id"]) / "clips"
        if json.loads((directory / "reference.json").read_text()) != spec["clip"]:
            raise ValueError("frozen dance clip changed")
        clip = load_clip("reference", directory)
        profile = self.studio().profile()
        if [joint["name"] for joint in profile["joints"]] != list(C.JOINT_NAMES):
            raise ValueError("dance profile joint order differs from simulator")
        ranges = []
        if "projectSnapshot" in spec:
            project = spec["projectSnapshot"]
            elapsed, start = 0, 0
            for index, block in enumerate(project["blocks"]):
                elapsed += block["beats"]
                end = round(60 * elapsed / project["recipe"]["parameters"]["bpm"] * CONTROL_HZ)
                if index == len(project["blocks"]) - 1:
                    end = clip.steps
                ranges.append((start, end))
                start = end
        reference = reference_descriptor(spec["clip"], clip.joints.tolist(), clip.pitch.tolist(), C.CTRL_DT,
                                         C.JOINT_NAMES, profile["rootBody"]["name"], ranges, evaluation, digest)
        plan = {"version": evaluation["dance"]["version"], "evaluation": evaluation, "reference": reference, "evaluatorSha256": bridge_hash(),
                "sourceFingerprint": self.fingerprint(), "physics": self.physics((None, run)),
                "runtimeVersions": runtime_versions(),
                "environment": {"behaviorId": spec["behaviorId"], "weights": spec["weights"]}}
        return {**plan, "sha256": digest(plan)}

    def validate_dance_plan(self, run, recompute=True):
        from dance_metrics import validate_plan_hash, validate_evaluation
        plan = run["dancePlan"]
        validate_plan_hash(plan, digest)
        validate_evaluation(plan["evaluation"], self.limits)
        if (plan["evaluatorSha256"] != bridge_hash() or plan["sourceFingerprint"] != self.fingerprint()
                or plan["runtimeVersions"] != runtime_versions() or plan["physics"] != self.physics((None, run))
                or plan["environment"] != {"behaviorId": run["spec"]["behaviorId"], "weights": run["spec"]["weights"]}
                or plan["reference"]["clipSha256"] != digest(run["spec"]["clip"])):
            raise ValueError("runtime dance provenance differs from the frozen pre-training plan")
        # Source, raw clip, and runtime identities pin admission's deterministic grid.
        # Training preflight must not load numeric runtimes before CPU worker forks.
        if recompute and plan != self.resolve_dance_plan(run, plan["evaluation"]):
            raise ValueError("runtime dance science differs from the frozen pre-training plan")

    def prepare_train(self, run_id, spec, evaluation=None):
        if evaluation is not None:
            from dance_metrics import validate_evaluation
            evaluation = validate_evaluation(evaluation, self.limits)
        spec = validate_spec(spec, self.limits)
        if spec["clip"] is not None or "projectRevisionId" in spec:
            studio = self.studio()
            project = None
            if "projectRevisionId" in spec:
                project = studio.project(spec["projectRevisionId"])
                if spec["clip"] is not None and project["clip"] != spec["clip"]:
                    raise ValueError("explicit clip differs from project revision clip")
                spec["clip"] = project["clip"]
            profile = studio.profile()
            studio.validate_clip_targets(spec["clip"], profile)
            if project is not None:
                if project["profile"] != profile:
                    raise ValueError("installed model differs from project profile")
                spec["projectSnapshot"] = project
        trainer = trainer_provenance(spec, self.limits) if spec["backend"] == "rlx" else trainer_provenance(spec)
        path = self.path(run_id)
        path.mkdir(parents=True, exist_ok=False)
        if spec["clip"] is not None:
            # Per-run immutable directory prevents same-name clips changing another experiment.
            write_json(path / "clips/reference.json", spec["clip"])
        run = {"formatVersion": 3,
               "provenance": {"bridgeSha256": bridge_hash(), "dependencyVersions": runtime_versions(),
                              "bam": bam_provenance(), "trainer": trainer,
                              "environment": {"domainRandomization": False, "randomYaw": False,
                                              "standingSpawns": True, "assistance": False,
                                              "updateDevice": trainer["learnerDevice"], "observationNoise": True, "actionDelay": True}},
               "id": run_id, "state": "starting", "createdAt": now(), "finishedAt": None,
               "spec": spec, "observationProfile": PHASE if spec["clip"] else STANDARD,
               "recipeHash": digest(spec), "sourceFingerprint": self.fingerprint(),
               "progress": None, "error": None, "policyId": None, "policySha256": None}
        if evaluation is not None:
            run["dancePlan"] = self.resolve_dance_plan(run, evaluation)
            self.configure_run(run)
        write_json(path / "manifest.json", run)
        return run

    def configure_run(self, run, training=False):
        if run["formatVersion"] != 3:
            raise ValueError("unsupported Robot Lab run format; only version 3 is supported")
        if run["provenance"]["bridgeSha256"] != bridge_hash():
            raise ValueError("Python bridge/studio bundle differs from the frozen run provenance")
        versions = runtime_versions()
        if run["provenance"]["dependencyVersions"] != versions:
            raise ValueError("Python dependency versions differ from the frozen run provenance")
        trainer = run["provenance"]["trainer"]
        for name, checksum in trainer["helperSha256"].items():
            if name not in ("mlx_ppo.py", "rlx_ppo.py") or file_hash(Path(__file__).with_name(name)) != checksum:
                raise ValueError("Python learner/exporter differs from frozen provenance")
        if run["spec"]["backend"] == "rlx":
            from rlx_ppo import source_fingerprint
            if source_fingerprint(self.limits.get("rlxSourceRoot")) != trainer["recipe"]["source"]:
                raise ValueError("RLX source differs from frozen trainer provenance")
        if training:
            current = (trainer_provenance(run["spec"], self.limits) if run["spec"]["backend"] == "rlx"
                       else trainer_provenance(run["spec"]))
            if trainer != current:
                raise ValueError("Python learner runtime differs from frozen provenance")
        if self.fingerprint() != run["sourceFingerprint"]:
            raise ValueError("Lab source/model fingerprint changed; cannot reproduce this run")
        verify_bam(run["provenance"].get("bam"))
        spec = run["spec"]
        path = self.path(run["id"])
        os.environ.pop("MICRODUCK_CLIP", None)
        os.environ["MICRODUCK_CLIPS_DIR"] = str(self.root / "clips")
        if spec["clip"] is not None:
            frozen = json.loads((path / "clips/reference.json").read_text())
            if frozen != spec["clip"]:
                raise ValueError("frozen clip changed")
            os.environ["MICRODUCK_CLIPS_DIR"] = str(path / "clips")
            os.environ["MICRODUCK_CLIP"] = "reference"
        if "dancePlan" in run:
            self.validate_dance_plan(run, recompute=not training)
        return spec

    def train(self, run_id):
        run = self.run(run_id)
        spec = self.configure_run(run, training=True)
        path = self.path(run_id)
        run["state"] = "running"
        write_json(path / "manifest.json", run)
        try:
            from microduck_local.behaviors import BehaviorEnv
            # Upstream CLI does not expose an actuator argument for tricks.
            # Adapt its factory rather than changing the read-only checkout.
            def make_env(behavior_id, rank, seed, weight_overrides=None):
                def create():
                    with frozen_bam(run["provenance"]["bam"]):
                        episode = ({"max_episode_s": run["provenance"]["trainer"]["recipe"]["episodeSeconds"]}
                                   if spec["backend"] == "rlx" else {})
                        return BehaviorEnv(behavior_id, weight_overrides=weight_overrides,
                                           seed=seed + rank, actuator=spec["actuator"],
                                           domain_rand=False, random_yaw=False, obs_noise=True,
                                           action_delay=True, standing_spawns=True, spotter=False, **episode)
                return create
            with contextlib.redirect_stdout(sys.stderr):
                if spec["backend"] == "rlx":
                    from rlx_ppo import train
                    train(path, spec, make_env, self.limits["snapshotSteps"], run["provenance"]["trainer"]["recipe"],
                          self.limits["rlxSourceRoot"])
                elif spec["backend"] == "mlx":
                    from mlx_ppo import train
                    train(path, spec, make_env, self.limits["snapshotSteps"], run["provenance"]["trainer"]["recipe"])
                else:
                    from microduck_local import train_behavior as trainer
                    trainer.make_env = make_env
                    trainer.RUNS_DIR = self.root / "runs"
                    sys.argv = ["train-behavior", spec["behaviorId"], "--run-name", run_id,
                                "--steps", str(spec["steps"]), "--envs", str(spec["envs"]),
                                "--seed", str(spec["seed"]), "--update-device", "cpu",
                                "--weights-json", json.dumps(spec["weights"]),
                                "--snap-steps", str(self.limits["snapshotSteps"])]
                    if spec["clip"] is not None:
                        sys.argv += ["--symmetry-coef", "0"]
                    trainer.main()
            if not (path / "policy.onnx").is_file():
                raise ValueError("trainer exited without exported policy.onnx")
            if spec["backend"] == "rlx":
                from rlx_ppo import verify_artifacts
                run["artifactSha256"] = {"rlx-artifacts.json": file_hash(path / "rlx-artifacts.json")}
                verify_artifacts(path, run["artifactSha256"], file_hash(path / "policy.onnx"))
                # Export may import source lazily; completion requires the same
                # source, helper, model, runtime, BAM, and clip after export too.
                self.configure_run(run)
            elif "dancePlan" in run:
                self.configure_run(run)
            run.update(state="completed", finishedAt=now(), policyId="run:" + run_id,
                       policySha256=file_hash(path / "policy.onnx"))
        except BaseException as exc:
            run.update(state="failed", finishedAt=now(), error=str(exc))
            write_json(path / "manifest.json", run)
            raise
        write_json(path / "manifest.json", run)
        return self.run(run_id)

    def policy_path(self, policy_id):
        if not isinstance(policy_id, str):
            raise ValueError("invalid policy identity")
        if policy_id.startswith("run:"):
            run = self.run(policy_id[4:])
            return self.path(run["id"]) / "policy.onnx", run
        if policy_id.startswith("shipped:"):
            name = policy_id[8:]
            if not re.fullmatch(r"[A-Za-z0-9_-]+", name):
                raise ValueError("invalid shipped policy identity")
            # Only walking and standing have verified standard command semantics here.
            if name not in ("alpha_walking", "alpha_stand"):
                raise ValueError("this shipped policy command encoding is not supported")
            path = (self.source / "microduck/policies" / (name + ".onnx")).resolve()
            if not path.is_relative_to(self.source):
                raise ValueError("policy escapes configured source")
            return path, None
        raise ValueError("unknown policy identity")

    def inspect_policy(self, policy_id):
        """Inspect immutable artifact integrity without requiring the current runtime."""
        path, run = self.policy_path(policy_id)
        if run:
            expected = run.get("policySha256")
            if (run["state"] != "completed" or run.get("policyId") != policy_id
                    or not isinstance(expected, str) or not re.fullmatch(r"[a-f0-9]{64}", expected)):
                raise ValueError("policy requires a completed run with frozen policySha256")
        data = path.read_bytes()
        checksum = hashlib.sha256(data).hexdigest()
        if run:
            if checksum != expected:
                raise ValueError("exported policy hash differs from frozen policySha256")
            if run["spec"]["backend"] == "rlx":
                from rlx_ppo import verify_artifacts
                verify_artifacts(path.parent, run.get("artifactSha256"), checksum)
        return path, run, data, checksum

    def load_policy(self, policy_id):
        """Verify runtime compatibility before sharing inspected bytes with inference."""
        loaded = self.inspect_policy(policy_id)
        if loaded[1] is not None:
            self.configure_run(loaded[1])
        return loaded

    def policy(self, policy_id, loaded=None):
        path, run, _, checksum = loaded if loaded is not None else self.inspect_policy(policy_id)
        compatibility = {"available": True, "reason": None}
        if run and loaded is None:
            try:
                self.configure_run(run)
            except (ValueError, OSError) as exc:
                # Intact historical artifacts remain inspectable across runtime upgrades.
                compatibility = {"available": False, "reason": str(exc)}
        evaluated = False
        for path_report in (self.root / "evaluations").glob("eval-*/report.json"):
            report = json.loads(path_report.read_text())
            if report.get("policyId") == policy_id and report.get("policyHash") == checksum:
                evaluated = True
                break
        return {"id": policy_id, "name": run["spec"]["name"] if run else path.stem,
                "runId": run["id"] if run else None, "sha256": checksum,
                "observationProfile": run["observationProfile"] if run else STANDARD,
                "verification": "evaluated" if evaluated else "unverified",
                "runtimeCompatibility": compatibility,
                "deployment": {"available": False, "reason": DEPLOY_REASON}}

    def policies(self):
        result = []
        for name in ("alpha_walking", "alpha_stand"):
            if (self.source / "microduck/policies" / (name + ".onnx")).is_file():
                result.append(self.policy("shipped:" + name))
        result += [self.policy("run:" + r["id"]) for r in self.runs() if r["policyId"]]
        return result

    def physics(self, loaded):
        run = loaded[1]
        return {"actuator": "bam", "bam": run["provenance"]["bam"] if run else bam_provenance(),
                "observationNoise": False, "actionDelay": True,
                "domainRandomization": False, "randomYaw": False}

    def rollout(self, loaded, physics, steps, seed, command, frames, dance_plan=None, controller=None):
        import numpy as np
        from microduck_local import contract as C
        _, run, data, _ = loaded
        if controller is None:
            import onnxruntime as ort
            session = ort.InferenceSession(data, providers=["CPUExecutionProvider"])
            inp, out = session.get_inputs()[0], session.get_outputs()[0]
            if inp.shape != [1, 61] or out.shape != [1, 14] or inp.type != "tensor(float)":
                raise ValueError("policy requires float32 [1,61] input and [1,14] output")
        # Evaluation and replay horizons are independent of the training episode length.
        with frozen_bam(physics["bam"]):
            if run:
                spec = run["spec"]
                from microduck_local.behaviors import BehaviorEnv
                env = BehaviorEnv(spec["behaviorId"], weight_overrides=spec["weights"],
                                  actuator="bam", seed=seed, standing_spawns=True, spotter=False,
                                  max_episode_s=steps * C.CTRL_DT,
                                  domain_rand=False, random_yaw=False, obs_noise=False, action_delay=True)
            else:
                from microduck_local.walk_env import MicroduckWalkEnv
                env = MicroduckWalkEnv(actuator="bam", seed=seed, domain_rand=False,
                                       max_episode_s=steps * C.CTRL_DT,
                                       random_yaw=False, obs_noise=False, action_delay=True)
        total_reward, upright, pose_error, recorded = 0.0, [], [], []
        terminated = truncated = False
        try:
            if (env.actuator_model != physics["actuator"] or env.obs_noise != physics["observationNoise"]
                    or env.action_delay != physics["actionDelay"] or env.domain_rand != physics["domainRandomization"]
                    or env.random_yaw != physics["randomYaw"] or env.bam.p != physics["bam"]["parameters"]):
                raise ValueError("resolved simulation physics differ from recorded settings")
            obs, _ = env.reset(seed=seed)
            settings = bam_settings(env)
            if frames or dance_plan is not None:
                from studio import model_layout, telemetry
                layout = model_layout(env.model)
            if dance_plan is not None:
                from dance_metrics import episode as dance_episode
                reference = dance_plan["reference"]
                clip = getattr(env, "clip", None)
                if (clip is None or clip.loop != reference["loop"]
                        or digest({"joints": clip.joints.tolist(), "pitch": clip.pitch.tolist()}) != reference["sampledSha256"]
                        or env.model.body(layout["rootBody"]).name != reference["rootBody"]
                        or list(C.JOINT_NAMES) != reference["jointNames"] or C.CTRL_DT != reference["controlDtSeconds"]
                        or env.model.opt.timestep * C.DECIMATION != C.CTRL_DT):
                    raise ValueError("rollout dance reference or physics clock differs from frozen plan")
                # The admitted horizon is integral control steps, independent of float seconds conversion.
                env.max_steps = steps
                root_address = int(env.model.jnt_qposadr[layout["rootJoint"]])
                initial_position = env.data.qpos[root_address:root_address + 3].tolist()
                initial_quaternion = env.data.qpos[root_address + 3:root_address + 7].tolist()
                measured = []
            for step in range(steps):
                if run is None:
                    env.twist_cmd[:] = command
                    # _get_obs advances joint-velocity history; reuse the reset/step observation.
                    obs = obs.copy()
                    obs[48:51] = command
                action = (session.run(None, {inp.name: np.asarray(obs[None], dtype=np.float32)})[0][0]
                          if controller is None else np.asarray(controller(obs, env.step_count), dtype=np.float32))
                if not np.isfinite(action).all():
                    raise ValueError("policy emitted non-finite actions")
                obs, reward, terminated, truncated, _ = env.step(action)
                total_reward += float(reward)
                if dance_plan is not None:
                    measured.append({"step": int(env.step_count), "joints": env.data.qpos[layout["qpos"]].tolist(),
                                     "rootPosition": env.data.qpos[root_address:root_address + 3].tolist(),
                                     "rootQuaternion": env.data.qpos[root_address + 3:root_address + 7].tolist()})
                # Gravity alignment, not an invented 'fall' counter. Inverted skills need other criteria.
                upright.append(float(-obs[5] >= 0.8))
                clip = getattr(env, "clip", None)
                if clip is not None:
                    target, _ = clip.at(env.step_count)
                    actual = env.data.qpos[env.joint_qpos_adr]
                    pose_error.append(float(np.mean((actual - target) ** 2)))
                if frames and (step % 2 == 0 or terminated or truncated):
                    state = telemetry(env.model, env.data, layout)
                    recorded.append({"step": int(env.step_count), "time": float(env.step_count * C.CTRL_DT),
                                     "bodies": np.column_stack((env.data.xpos, env.data.xquat)).tolist(),
                                     "reward": float(reward), "terminated": bool(terminated),
                                     "telemetry": state})
                if terminated or truncated:
                    break
            result = {"seed": seed, "steps": step + 1, "terminated": bool(terminated), "bamSettings": settings,
                      "reward": total_reward, "uprightFraction": float(np.mean(upright)),
                      "poseRmse": float(math.sqrt(np.mean(pose_error))) if pose_error else None}
            if dance_plan is not None:
                result["dance"] = dance_episode(dance_plan, measured, clip.joints.tolist(), clip.pitch.tolist(),
                                                initial_position, initial_quaternion, env.step_count, terminated, truncated)
            return result, recorded
        finally:
            env.close()

    def simulate(self, request):
        steps = number(request["steps"], "simulation steps", 1, self.limits["maxSimulationSteps"], True)
        seed = number(request["seed"], "seed", 0, 2147483647, True)
        command = request["command"]
        if not isinstance(command, list) or len(command) != 3:
            raise ValueError("command requires vx, vy, yaw rate")
        for value, bound in zip(command, (0.4, 0.3, 1.0)):
            number(value, "command", -bound, bound)
        loaded = self.load_policy(request["policyId"])
        policy = self.policy(request["policyId"], loaded)
        physics = self.physics(loaded)
        episode, frames = self.rollout(loaded, physics, steps, seed, command, True)
        return {"mode": "recorded-simulation", "policyId": policy["id"], "policyHash": policy["sha256"],
                "observationProfile": policy["observationProfile"], "controlHz": 50, "frames": frames,
                "physics": physics, "bamSettings": episode["bamSettings"]}

    def evaluate(self, spec):
        n = number(spec["episodes"], "episodes", 1, self.limits["maxEvaluationEpisodes"], True)
        steps = number(spec["stepsPerEpisode"], "episode steps", 1, self.limits["maxSimulationSteps"], True)
        seed = number(spec["seed"], "seed", 0, 2147483647 - n, True)
        number(spec["maxTerminations"], "maxTerminations", 0, n, True)
        number(spec["minMeanUprightFraction"], "minMeanUprightFraction", 0, 1)
        spec = json.loads(json.dumps(spec, allow_nan=False))
        loaded = self.load_policy(spec["policyId"])
        policy = self.policy(spec["policyId"], loaded)
        physics = self.physics(loaded)
        dance_plan = None
        if "dance" in spec:
            run = loaded[1]
            if run is None or "dancePlan" not in run:
                raise ValueError("dance evaluation requires a frozen pre-training plan on the owned run")
            dance_plan = run["dancePlan"]
            if {k: v for k, v in spec.items() if k != "policyId"} != dance_plan["evaluation"]:
                raise ValueError("dance evaluation differs from the frozen pre-training criteria")
            self.validate_dance_plan(run)
            if physics != dance_plan["physics"]:
                raise ValueError("dance evaluation physics differ from the frozen plan")
        evaluation_id = "eval-" + str(uuid.uuid4())
        path = self.root / "evaluations" / evaluation_id
        path.mkdir(parents=True, exist_ok=False, mode=0o700)
        admission = {"id": evaluation_id, "createdAt": now(), "policyId": policy["id"],
                     "policyHash": policy["sha256"], "spec": spec, "physics": physics,
                     "observationProfile": policy["observationProfile"]}
        if dance_plan is not None:
            admission["dancePlan"] = dance_plan
        write_json(path / "request.json", admission)
        options = {"dance_plan": dance_plan} if dance_plan is not None else {}
        episodes = [self.rollout(loaded, physics, steps, seed + ep, [0, 0, 0], False, **options)[0] for ep in range(n)]
        report = {**admission, "episodes": episodes,
                  "passed": sum(e["terminated"] for e in episodes) <= spec["maxTerminations"] and sum(e["uprightFraction"] for e in episodes) / n >= spec["minMeanUprightFraction"],
                  "limitations": ["Local deterministic BAM evaluation, not hardware approval.",
                                  "Termination is not a universal fall detector.",
                                  "Upright criteria do not establish choreography completion or suitability for inverted tricks.",
                                  "The domain-randomization flag was disabled; seeded reset and BAM variation remain. No physical trial was performed."], "evaluatedAt": now()}
        if dance_plan is not None:
            from dance_metrics import evaluation_status
            self.configure_run(loaded[1])
            report["danceStatus"] = evaluation_status([ep["dance"] for ep in episodes], spec["dance"])
            report["limitations"] += ["Dance coverage uses the frozen runtime control grid, which may differ from the authored music clock.",
                                       "Nominal seeded rollouts are repeatability evidence, not robustness or hardware qualification."]
        write_json(path / "report.json", report)
        return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--root", required=True, type=Path)
    args = parser.parse_args()
    payload = json.load(sys.stdin)
    bridge = Bridge(args.source, args.root, payload["limits"])
    request = payload["request"]
    op = request["operation"]
    with contextlib.redirect_stdout(sys.stderr):
        if op == "studio":
            result = {"operation": op, "catalog": bridge.studio().catalog()}
        elif op == "save_project":
            result = {"operation": op, "project": bridge.studio().save(request["recipe"])}
        elif op == "projects":
            result = {"operation": op, "projects": bridge.studio().projects()}
        elif op == "project":
            result = {"operation": op, "project": bridge.studio().project(request["projectRevisionId"])}
        elif op == "reference_preview":
            result = {"operation": op, "preview": bridge.studio().preview(request["projectRevisionId"])}
        elif op == "readiness":
            result = {"operation": op, "readiness": bridge.readiness(request.get("backend", "cpu"))}
        elif op == "runs":
            result = {"operation": op, **bridge.list_runs()}
        elif op in ("behaviors", "scene", "policies"):
            result = {"operation": op, op: getattr(bridge, op)()}
        elif op == "run":
            result = {"operation": op, "run": bridge.run(request["runId"])}
        elif op == "prepare_train":
            result = {"operation": "train", "run": bridge.prepare_train(request["runId"], request["spec"], request.get("evaluation"))}
        elif op == "train":
            result = {"operation": op, "run": bridge.train(request["runId"])}
        elif op == "simulate":
            result = {"operation": op, "simulation": bridge.simulate(request)}
        elif op == "evaluate":
            result = {"operation": op, "evaluation": bridge.evaluate(request["spec"])}
        elif op == "prepare":
            policy = bridge.policy(request["policyId"])
            reasons = [DEPLOY_REASON]
            if policy["observationProfile"] == PHASE:
                reasons.append("Lab phase occupies body pitch/yaw observation fields; target robot phase encoding differs.")
            result = {"operation": op, "policyId": policy["id"], "allowed": False, "reasons": reasons}
        else:
            raise ValueError("unsupported bridge operation")
    print(json.dumps(result, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
