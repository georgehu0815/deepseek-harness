"""Thin RLX integration: CPU workers, the configured RLX PPO, and verified ONNX.

Importing this helper loads no numeric runtime. The bridge owns admission and
publication; Harness supervises the process tree. RLX owns the optimizer, model,
rollout buffer, GAE, and observation adapter. Checkpoints are not resumable runs.
"""
from __future__ import annotations

from collections import deque
import hashlib
import json
import math
from numbers import Integral
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile
import time


FIELDS = {
    "horizon", "numMinibatches", "epochs", "learningRate", "gamma", "gaeLambda",
    "normalizeAdvantages", "clipCoefficient", "clipValueLoss", "entropyCoefficient",
    "valueCoefficient", "maxGradNorm", "observationClip", "normalizationEpsilon",
    "minimumEpisodeSeconds",
}


def source_root(value):
    """Resolve the host-configured RLX checkout; requests cannot select this path."""
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise ValueError("rlxSourceRoot must be an absolute configured path")
    root = Path(value).resolve(strict=True)
    for name in ("pyproject.toml", "rlx/algorithms/ppo.py", "rlx/environments/microduck.py",
                 "rlx/models/microduck.py", "rlx/export/microduck_onnx.py"):
        path = (root / name).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("RLX source file escapes configured checkout or is missing")
    return root


def source_fingerprint(value):
    """Hash source contents, including dirty edits, without importing RLX or MLX."""
    root = source_root(value)
    paths = [root / "pyproject.toml", *sorted((root / "rlx").rglob("*.py"))]
    if (root / "uv.lock").is_file():
        paths.append(root / "uv.lock")
    hashes = {}
    for path in paths:
        if not path.resolve(strict=True).is_relative_to(root):
            raise ValueError("RLX source file escapes configured checkout")
        hashes[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    checksum = hashlib.sha256(json.dumps(hashes, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"sha256": checksum, "fileCount": len(hashes)}


def recipe(spec, limits):
    """Resolve explicit PPO configuration and bounded whole-rollout step accounting."""
    config = limits.get("rlxPpo")
    if not isinstance(config, dict) or set(config) != FIELDS:
        raise ValueError("rlxPpo must contain the complete supported PPO configuration")
    config = dict(config)
    for name in ("horizon", "numMinibatches", "epochs"):
        if type(config[name]) is not int or config[name] < 1:
            raise ValueError(f"rlxPpo.{name} must be a positive integer")
    for name in ("normalizeAdvantages", "clipValueLoss"):
        if type(config[name]) is not bool:
            raise ValueError(f"rlxPpo.{name} must be a boolean")
    for name in FIELDS - {"horizon", "numMinibatches", "epochs", "normalizeAdvantages", "clipValueLoss"}:
        value = config[name]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"rlxPpo.{name} must be finite")
        if name in ("gamma", "gaeLambda"):
            valid = 0 <= value <= 1
        elif name in ("entropyCoefficient", "valueCoefficient"):
            valid = value >= 0
        else:
            valid = value > 0
        if not valid:
            raise ValueError(f"rlxPpo.{name} is outside its supported range")
    steps, envs = spec["steps"], spec["envs"]
    if any(type(value) is not int or value < 1 for value in (steps, envs)):
        raise ValueError("RLX training steps and envs must be positive integers")
    config["horizon"] = min(config["horizon"], (steps + envs - 1) // envs)
    batch = config["horizon"] * envs
    config["numMinibatches"] = min(config["numMinibatches"], batch)
    while batch % config["numMinibatches"]:
        config["numMinibatches"] -= 1
    actual = ((steps + batch - 1) // batch) * batch
    if actual > limits["maxTrainingSteps"]:
        raise ValueError("RLX rounded rollout budget exceeds maxTrainingSteps")
    from microduck_local.contract import CTRL_DT
    if isinstance(CTRL_DT, bool) or not isinstance(CTRL_DT, (int, float)) or not math.isfinite(CTRL_DT) or CTRL_DT <= 0:
        raise ValueError("simulator CTRL_DT must be finite and positive")
    duration = spec["clip"]["duration"] if spec.get("clip") else 0
    requested_episode = max(config["minimumEpisodeSeconds"], duration)
    episode_steps = math.ceil(requested_episode / CTRL_DT)
    # Compare effective float times so division roundoff adds no gratuitous step
    # and never produces an episode shorter than the requested duration.
    if episode_steps > 1 and (episode_steps - 1) * CTRL_DT >= requested_episode:
        episode_steps -= 1
    if episode_steps * CTRL_DT < requested_episode:
        episode_steps += 1
    return {**config, "version": "rlx-microduck-ppo-v1",
            "source": source_fingerprint(limits.get("rlxSourceRoot")),
            "requestedEpisodeSeconds": requested_episode, "controlDtSeconds": CTRL_DT,
            "episodeSteps": episode_steps, "episodeSeconds": episode_steps * CTRL_DT,
            "requestedSteps": steps, "actualSteps": actual, "batchSize": batch,
            "normalizationArithmetic": "float64-then-float32",
            "actionSemantics": "raw-gaussian-env-clip-mean-v1",
            "rewardNormalization": False, "vectorBackend": "fork"}


def probe(value):
    """Check the configured RLX imports and Metal in a disposable child only."""
    root = source_root(value)
    if platform.system() != "Darwin" or platform.machine() != "arm64" or sys.version_info[:2] != (3, 12):
        raise ValueError("RLX Metal requires macOS arm64 and Python 3.12")
    code = (
        "import sys,json; sys.path.insert(0,sys.argv[1]); "
        "import mlx.core as mx; assert mx.metal.is_available(), 'Metal GPU is unavailable'; "
        "mx.set_default_device(mx.gpu); x=mx.array([1.0])+1; mx.eval(x); assert x.item()==2; "
        "from rlx.algorithms.ppo import PPO,PPOConfig; "
        "import inspect; observer=inspect.signature(PPO.train).parameters.get('observer'); "
        "assert observer is not None and observer.kind is inspect.Parameter.KEYWORD_ONLY, 'RLX PPO.train requires keyword-only observer support'; "
        "from rlx.environments.microduck import MicroDuckVecEnv; "
        "from rlx.models.microduck import create_actor_critic; "
        "from rlx.export.microduck_onnx import export_deterministic_actor; "
        "print(json.dumps(mx.device_info()))"
    )
    result = subprocess.run([sys.executable, "-B", "-c", code, str(root)],
                            capture_output=True, text=True, timeout=30, check=False)
    if result.returncode:
        raise ValueError("RLX Metal/import probe failed: " + result.stderr[-4096:])
    return json.loads(result.stdout)["device_name"]


def _activate(value, expected):
    root = source_root(value)
    if source_fingerprint(str(root)) != expected:
        raise ValueError("RLX source differs from frozen trainer provenance")
    for name, module in tuple(sys.modules.items()):
        if name == "rlx" or name.startswith("rlx."):
            path = getattr(module, "__file__", None)
            if path is None or not Path(path).resolve().is_relative_to(root):
                raise ValueError("another RLX checkout is already imported")
    sys.path.insert(0, str(root))


def export_policy(path, checkpoint, model, env, observations):
    """Adapt RLX's actor export to fixed batch and the actual float64 normalizer.

    RLX's checkpoint/export rounds RMS statistics to float32. Retain its actor
    graph but replace normalization using the live adapter's frozen statistics.
    Publish only after CPU ORT matches that actual training-time arithmetic.
    """
    import numpy as np
    import mlx.core as mx
    import onnx
    from onnx import helper, numpy_helper, TensorProto
    import onnxruntime as ort
    from rlx.export.microduck_onnx import export_deterministic_actor

    mean = np.asarray(env.observation_rms.mean, np.float64).copy()
    variance = np.asarray(env.observation_rms.var, np.float64).copy()
    if mean.shape != (61,) or variance.shape != (61,) or not np.isfinite(mean).all() or not np.isfinite(variance).all() or (variance < 0).any():
        raise ValueError("invalid actual RLX observation normalizer")
    std = np.sqrt(variance + env.epsilon)
    with tempfile.TemporaryDirectory(prefix=".rlx-export-", dir=path) as temporary:
        target = Path(temporary) / "policy.onnx"
        export_deterministic_actor(checkpoint, target)
        original_session = ort.InferenceSession(target.read_bytes(), providers=["CPUExecutionProvider"])
        graph = onnx.load(target)
        nodes = list(graph.graph.node)
        expected_ops = ["Sub", "Add", "Sqrt", "Div", "Clip"]
        if [node.op_type for node in nodes[:5]] != expected_ops or list(nodes[4].output) != ["hidden_0"]:
            raise ValueError("unsupported RLX exporter normalization graph")
        prefix = [
            helper.make_node("Cast", ["observations"], ["dsh_obs64"], to=TensorProto.DOUBLE),
            helper.make_node("Sub", ["dsh_obs64", "dsh_mean64"], ["dsh_centered64"]),
            helper.make_node("Div", ["dsh_centered64", "dsh_std64"], ["dsh_scaled64"]),
            helper.make_node("Clip", ["dsh_scaled64", "dsh_low64", "dsh_high64"], ["dsh_clipped64"]),
            helper.make_node("Cast", ["dsh_clipped64"], ["hidden_0"], to=TensorProto.FLOAT),
        ]
        del graph.graph.node[:]
        graph.graph.node.extend(prefix + nodes[5:])
        old_stats = {"obs_mean", "obs_variance", "epsilon", "clip_min", "clip_max"}
        initializers = [value for value in graph.graph.initializer if value.name not in old_stats]
        initializers.extend(numpy_helper.from_array(value, name) for name, value in {
            "dsh_mean64": mean, "dsh_std64": std,
            "dsh_low64": np.array(-env.clip, np.float64), "dsh_high64": np.array(env.clip, np.float64),
        }.items())
        del graph.graph.initializer[:]
        graph.graph.initializer.extend(initializers)
        for value, width in ((graph.graph.input[0], 61), (graph.graph.output[0], 14)):
            dims = value.type.tensor_type.shape.dim
            if len(dims) != 2 or dims[0].dim_param != "batch" or dims[1].dim_value != width:
                raise ValueError("unsupported RLX exporter tensor dimensions")
            dims[0].ClearField("dim_param")
            dims[0].dim_value = 1
        onnx.checker.check_model(graph)
        data = graph.SerializeToString()
        session = ort.InferenceSession(data, providers=["CPUExecutionProvider"])
        probes = [np.zeros((1, 61), np.float32)]
        probes.extend(np.asarray(observations, np.float32).reshape(-1, 61)[:, None, :])
        probes.extend((mean + sign * std * env.clip)[None].astype(np.float32) for sign in (-1, 1))
        if not observations:
            raise ValueError("RLX export requires actual training observations")
        maximum = checkpoint_maximum = 0.0
        for values in probes:
            normalized = np.clip((values - mean) / std, -env.clip, env.clip).astype(np.float32)
            expected = np.asarray(model.deterministic(mx.array(normalized)), np.float32)
            actual = session.run(["actions"], {"observations": values})[0]
            checkpoint_actual = original_session.run(["actions"], {"observations": values})[0]
            if not np.isfinite(checkpoint_actual).all():
                raise ValueError("non-finite RLX checkpoint-normalizer export")
            checkpoint_maximum = max(checkpoint_maximum, float(np.max(np.abs(checkpoint_actual - expected))))
            if not np.isfinite(actual).all() or not np.isfinite(expected).all():
                raise ValueError("non-finite RLX export parity result")
            maximum = max(maximum, float(np.max(np.abs(actual - expected))))
            np.testing.assert_allclose(actual, expected, rtol=1e-4, atol=1e-5)
        np.savez(path / "normalizer.npz", mean=mean, variance=variance,
                 count=np.array(env.observation_rms.count), epsilon=np.array(env.epsilon), clip=np.array(env.clip))
        evidence = {"reference": "live-actor-actual-float64-normalizer", "probeCount": len(probes),
                    "realObservationCount": len(observations), "maxAbsoluteError": maximum,
                    "checkpointFloat32MaxAbsoluteError": checkpoint_maximum,
                    "rtol": 1e-4, "atol": 1e-5, "inputShape": [1, 61], "outputShape": [1, 14]}
        (path / "export-parity.json").write_text(json.dumps(evidence, allow_nan=False) + "\n")
        artifact_names = ("rlx.safetensors", "rlx.safetensors.json", "normalizer.npz", "export-parity.json")
        hashes = {name: hashlib.sha256((path / name).read_bytes()).hexdigest() for name in artifact_names}
        hashes["policy.onnx"] = hashlib.sha256(data).hexdigest()
        (path / "rlx-artifacts.json").write_text(json.dumps({"version": 1, "sha256": hashes}, sort_keys=True) + "\n")
        target.write_bytes(data)
        target.replace(path / "policy.onnx")


def verify_artifacts(path, frozen, policy_sha256):
    """Verify the manifest-anchored snapshot, JSON metadata, normalizer, and ONNX."""
    if not isinstance(frozen, dict) or set(frozen) != {"rlx-artifacts.json"}:
        raise ValueError("RLX policy requires frozen artifactSha256")
    manifest_path = (path / "rlx-artifacts.json").resolve(strict=True)
    if not manifest_path.is_relative_to(path.resolve()):
        raise ValueError("RLX artifact manifest escapes its owned run")
    manifest = manifest_path.read_bytes()
    if hashlib.sha256(manifest).hexdigest() != frozen["rlx-artifacts.json"]:
        raise ValueError("RLX artifact manifest hash differs from frozen provenance")
    value = json.loads(manifest)
    expected = {"rlx.safetensors", "rlx.safetensors.json", "normalizer.npz", "export-parity.json", "policy.onnx"}
    if not isinstance(value, dict) or set(value) != {"version", "sha256"} or type(value["version"]) is not int or value["version"] != 1:
        raise ValueError("unsupported RLX artifact manifest")
    hashes = value["sha256"]
    if not isinstance(hashes, dict) or set(hashes) != expected or hashes["policy.onnx"] != policy_sha256:
        raise ValueError("RLX artifacts differ from the exported policy")
    for name, checksum in hashes.items():
        target = (path / name).resolve(strict=True)
        if not target.is_relative_to(path.resolve()):
            raise ValueError("RLX artifact escapes its owned run")
        if not isinstance(checksum, str) or not re.fullmatch(r"[a-f0-9]{64}", checksum) or hashlib.sha256(target.read_bytes()).hexdigest() != checksum:
            raise ValueError("RLX artifact hash mismatch: " + name)


_EPISODE_LENGTH_UPPER_BOUNDS = (1, 4, 8, 16, 32, 64, 128, 256, 512, 1024, None)
_REFERENCE_INDEX_BINS = 32


def _training_reference(path, clip_spec):
    """Read only the explicit owned clip using the same runtime grid as workers."""
    if clip_spec is None:
        return None
    from microduck_local.motion import load_clip
    directory = path / "clips"
    data = (directory / "reference.json").read_bytes()
    if json.loads(data) != clip_spec:
        raise ValueError("training diagnostics reference differs from the frozen clip")
    clip = load_clip("reference", directory)
    return {"clipFileSha256": hashlib.sha256(data).hexdigest(), "clipSteps": clip.steps, "loop": clip.loop}


class _TrainingDiagnostics:
    """Bounded host counters from RLX's copied episode ages and done mask.

    Exposure infers post-step reward reference indices from zero-start episode
    ages, not observed policy inputs, tracking, uprightness or successful motion.
    Completed-length bins have inclusive upper bounds; the final bin is overflow.
    """

    def __init__(self, envs, total, episode_steps, reference):
        self.envs, self.total, self.episode_steps = envs, total, episode_steps
        self.observed = self.maximum_age = 0
        self.active = [0] * envs
        self.completed = {kind: {"count": 0, "lengthSum": 0, "minLength": None, "maxLength": None,
                                 "histogramCounts": [0] * len(_EPISODE_LENGTH_UPPER_BOUNDS)}
                          for kind in ("terminated", "truncated")}
        self.reference = reference
        self.reference_counts = [0] * _REFERENCE_INDEX_BINS
        self.traversals = 0

    def on_step(self, info, prior_steps):
        lengths, done, infos = info["episode"]["l"], info["_episode"], info["infos"]
        if prior_steps != self.observed or prior_steps + self.envs > self.total:
            raise ValueError("training diagnostics callback sequence differs from collected transitions")
        if any(len(values) != self.envs for values in (lengths, done, infos)):
            raise ValueError("training diagnostics require one episode age and done flag per environment")
        rows = []
        for index, (length, ended, details) in enumerate(zip(lengths, done, infos)):
            if (not isinstance(length, Integral) or isinstance(length, bool)
                    or length != self.active[index] + 1 or length > self.episode_steps):
                raise ValueError("training diagnostics episode age differs from its zero-start counter or limit")
            age = int(length)
            truncated = bool(ended) and bool(details.get("TimeLimit.truncated", False))
            if truncated and age != self.episode_steps:
                raise ValueError("training diagnostics timeout differs from the admitted episode limit")
            rows.append((age, bool(ended), truncated))
        for index, (age, ended, truncated) in enumerate(rows):
            self.maximum_age = max(self.maximum_age, age)
            self.active[index] = 0 if ended else age
            if ended:
                summary = self.completed["truncated" if truncated else "terminated"]
                summary["count"] += 1
                summary["lengthSum"] += age
                summary["minLength"] = age if summary["minLength"] is None else min(summary["minLength"], age)
                summary["maxLength"] = age if summary["maxLength"] is None else max(summary["maxLength"], age)
                bucket = next(i for i, upper in enumerate(_EPISODE_LENGTH_UPPER_BOUNDS) if upper is None or age <= upper)
                summary["histogramCounts"][bucket] += 1
            if self.reference is not None:
                steps = self.reference["clipSteps"]
                target = age % steps if self.reference["loop"] else min(age, steps - 1)
                self.reference_counts[target * _REFERENCE_INDEX_BINS // steps] += 1
                traversed = age % steps == 0 if self.reference["loop"] else age == steps
                if traversed:
                    self.traversals += 1
        self.observed += self.envs

    def snapshot(self):
        """Return independent checkpoint metadata; active lengths are right-censored."""
        completed_steps = sum(summary["lengthSum"] for summary in self.completed.values())
        if completed_steps + sum(self.active) != self.observed:
            raise ValueError("training diagnostics completed lengths and censored tails do not account for collected transitions")
        exposure = None if self.reference is None else {
            **self.reference, "semantics": "source-derived-post-step-reward-reference-index-v1",
            "binCount": _REFERENCE_INDEX_BINS, "binCounts": list(self.reference_counts),
            "elapsedReferenceTraversals": self.traversals}
        return {"version": 1, "observedTransitions": self.observed, "admittedTransitions": self.total,
                "collectionComplete": self.observed == self.total, "episodeStepLimit": self.episode_steps,
                "maxObservedEpisodeAge": self.maximum_age,
                "lengthHistogramUpperBoundsSteps": list(_EPISODE_LENGTH_UPPER_BOUNDS),
                "completedEpisodes": {kind: {**summary, "histogramCounts": list(summary["histogramCounts"])}
                                      for kind, summary in self.completed.items()},
                "rightCensoredEpisodeLengths": list(self.active), "referenceExposure": exposure,
                "referenceExposureUnavailableReason": None if exposure is not None else
                "No explicit owned custom reference was selected; default behavior references were not measured."}


class _RlxProgress:
    """Persist completed intervals at the existing step cadence, never per observer event.

    Timings exclude incomplete and failed intervals; zero does not mean no cost.
    Loss is the last rollout's mean weighted total objective; transfer time is not isolated.
    """

    def __init__(self, stream, envs, total, snapshot_steps, started, diagnostics):
        self.stream, self.envs, self.total = stream, envs, total
        self.diagnostics = diagnostics
        self.snapshot_steps, self.started, self.next_progress = snapshot_steps, started, 0
        self.rewards = deque(maxlen=100)
        self.collection_steps = self.update_steps = self.observed_steps = 0
        self.metrics = {"version": 1, "completedRollouts": 0, "optimizerSteps": 0,
                        "lastMeanLoss": None, "collectionSeconds": 0.0, "updateSeconds": 0.0,
                        "checkpointSeconds": None, "exportSeconds": None}

    def observe(self, event):
        if event["phase"] == "collection":
            self.collection_steps += event["steps"]
            self.metrics["collectionSeconds"] += event["seconds"]
        elif event["phase"] == "update":
            self.update_steps += event["steps"]
            self.metrics["updateSeconds"] += event["seconds"]
            self.metrics["optimizerSteps"] += event["optimizer_steps"]
            self.metrics["lastMeanLoss"] = event["mean_loss"]
            self.metrics["completedRollouts"] += 1
        else:
            raise ValueError("unsupported RLX observer phase")

    def emit(self, steps, elapsed):
        self.stream.write(json.dumps({"steps": steps, "total": self.total, "elapsed_s": elapsed,
                                      "ep_rew": sum(self.rewards) / len(self.rewards) if self.rewards else None,
                                      "rlx": self.metrics, "trainingDiagnostics": self.diagnostics.snapshot()}, allow_nan=False) + "\n")
        self.stream.flush()

    def on_step(self, info, prior_steps):
        self.diagnostics.on_step(info, prior_steps)
        count = prior_steps + self.envs
        self.observed_steps = count
        for reward, done in zip(info["episode"]["r"], info["_episode"]):
            if done:
                self.rewards.append(float(reward))
        if count >= self.next_progress:
            self.emit(count, time.monotonic() - self.started)
            self.next_progress = count + self.snapshot_steps


def train(path, spec, make_env, snapshot_steps, learner_recipe, configured_source):
    """Run the user's PPO once, retaining real observations and structured progress."""
    if spec.get("backend") != "rlx":
        raise ValueError("RLX learner requires the explicitly selected rlx backend")
    if type(snapshot_steps) is not int or snapshot_steps < 1:
        raise ValueError("snapshotSteps must be a positive integer")
    if "mlx.core" in sys.modules or "torch" in sys.modules:
        raise RuntimeError("RLX requires fresh-process CPU worker forks before MLX or Torch imports")
    _activate(configured_source, learner_recipe["source"])
    path = Path(path)
    if (path / "policy.onnx").exists():
        raise ValueError("RLX cannot overwrite an existing final policy")
    from microduck_local.vec_env import make_vec_env
    raw = make_vec_env([make_env(spec["behaviorId"], rank, spec["seed"], spec["weights"] or None)
                        for rank in range(spec["envs"])], backend="fork")
    try:
        import numpy as np
        import mlx.core as mx
        import mlx.optimizers as optim
        from rlx.algorithms.ppo import PPO, PPOConfig
        from rlx.buffers.rollout_buffer import RolloutBuffer
        from rlx.environments.microduck import MicroDuckVecEnv
        from rlx.models.microduck import create_actor_critic, save_checkpoint

        diagnostics = _TrainingDiagnostics(spec["envs"], learner_recipe["actualSteps"], learner_recipe["episodeSteps"],
                                           _training_reference(path, spec["clip"]))
        mx.set_default_device(mx.gpu)
        np.random.seed(spec["seed"])
        mx.random.seed(spec["seed"])
        observations = deque(maxlen=32)

        class ObservedEnvironment(MicroDuckVecEnv):
            def _normalize_observation(self, observation, *, update=True):
                if update:
                    observations.extend(np.asarray(observation, np.float32).copy())
                return super()._normalize_observation(observation, update=update)

        env = ObservedEnvironment(raw, normalize_observations=True, normalize_rewards=False,
                                  gamma=learner_recipe["gamma"], epsilon=learner_recipe["normalizationEpsilon"],
                                  clip=learner_recipe["observationClip"])
        config = PPOConfig(num_envs=spec["envs"], num_steps=learner_recipe["horizon"],
                           num_minibatches=learner_recipe["numMinibatches"], update_epochs=learner_recipe["epochs"],
                           gamma=learner_recipe["gamma"], gae_lambda=learner_recipe["gaeLambda"],
                           normalize_advantages=learner_recipe["normalizeAdvantages"],
                           clip_coefficient=learner_recipe["clipCoefficient"], clip_value_loss=learner_recipe["clipValueLoss"],
                           entropy_coefficient=learner_recipe["entropyCoefficient"], value_coefficient=learner_recipe["valueCoefficient"],
                           max_grad_norm=learner_recipe["maxGradNorm"])
        model = create_actor_critic()
        mx.eval(model.parameters())
        algorithm = PPO(config=config, env=env, network=model,
                        optimizer=optim.Adam(learning_rate=learner_recipe["learningRate"]),
                        buffer=RolloutBuffer(config.num_steps, env.observation_space, env.action_space,
                                             gamma=config.gamma, num_envs=config.num_envs),
                        key=mx.random.key(spec["seed"]))
        started = time.monotonic()
        with (path / "progress.jsonl").open("a") as progress:
            report = _RlxProgress(progress, spec["envs"], learner_recipe["actualSteps"], snapshot_steps, started, diagnostics)
            try:
                algorithm.train(spec["steps"], callback=report.on_step, observer=report.observe)
            finally:
                training_elapsed = time.monotonic() - started
                report.emit(max(algorithm.step, report.observed_steps), training_elapsed)
            if algorithm.step != learner_recipe["actualSteps"]:
                raise ValueError("RLX collected steps differ from admitted rollout budget")
            rollouts = learner_recipe["actualSteps"] // learner_recipe["batchSize"]
            if (report.collection_steps != algorithm.step or report.update_steps != algorithm.step
                    or report.metrics["completedRollouts"] != rollouts):
                raise ValueError("RLX completed observer intervals differ from admitted rollout budget")
            if report.metrics["optimizerSteps"] != rollouts * learner_recipe["epochs"] * learner_recipe["numMinibatches"]:
                raise ValueError("RLX completed optimizer steps differ from admitted PPO configuration")
            training_diagnostics = diagnostics.snapshot()
            if not training_diagnostics["collectionComplete"]:
                raise ValueError("RLX training diagnostics do not account for the admitted rollout budget")
            try:
                checkpoint = path / "rlx.safetensors"
                checkpoint_started = time.monotonic()
                save_checkpoint(checkpoint, model, env.observation_rms.mean, env.observation_rms.var,
                                env.observation_rms.count, epsilon=env.epsilon, clip=env.clip,
                                metadata={"recipe": learner_recipe, "requestedSteps": spec["steps"], "actualSteps": algorithm.step,
                                          "normalizerArtifact": "normalizer.npz", "resumable": False,
                                          "trainingDiagnostics": training_diagnostics})
                report.metrics["checkpointSeconds"] = time.monotonic() - checkpoint_started
                if source_fingerprint(configured_source) != learner_recipe["source"]:
                    raise ValueError("RLX source changed during training")
                export_started = time.monotonic()
                export_policy(path, checkpoint, model, env, list(observations))
                report.metrics["exportSeconds"] = time.monotonic() - export_started
            finally:
                # Preserve the training clock even when checkpoint/export fails or takes time.
                report.emit(algorithm.step, training_elapsed)
    finally:
        raw.close()
