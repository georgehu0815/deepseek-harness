"""DSH-owned PPO: Metal learning with CPU MicroDuck physics and portable ONNX.

Importing this module does not initialize MLX or Torch. ``train`` owns its fork
workers, numeric snapshots and progress; the bridge owns admission and manifests.
Policies use raw Gaussian actions, environment-side actuation limits, and a frozen
observation normalizer. This implementation does not import or copy RLX.
"""
from __future__ import annotations

from collections import deque
import json
import math
from pathlib import Path
import random
import signal
import sys
import tempfile
import time

import numpy as np


def recipe(spec=None, overrides=None):
    """Resolve a JSON recipe, including the effective horizon for a bounded run.

    ``overrides`` accepts recipe fields, including a previously resolved recipe.
    The bridge must persist the returned values when admitting custom recipes.
    """
    result = {
        "version": "dsh-mlx-ppo-v1", "hiddenSizes": [512, 256, 128],
        "horizon": 256, "minibatchSize": 1024, "epochs": 5,
        "gamma": 0.99, "gaeLambda": 0.95, "clipRange": 0.2,
        "learningRateStart": 1e-3, "learningRateEnd": 1e-4,
        "entropyStart": 0.01, "valueCoefficient": 1.0,
        "maxGradNorm": 1.0, "adamEpsilon": 1e-5, "logStdMax": -0.5,
        "clipObservation": 100.0, "normalizationEpsilon": 1e-8,
        "normalizationArithmetic": "float64-then-float32",
        "symmetryCoefficient": 0.0, "rewardNormalization": False,
        "actionSemantics": "raw-gaussian-env-clip-mean-v1",
        "learnerDevice": "metal", "physicsDevice": "cpu", "vectorBackend": "fork",
    }
    fixed = {key: result[key] for key in (
        "version", "symmetryCoefficient", "rewardNormalization", "actionSemantics",
        "learnerDevice", "physicsDevice", "vectorBackend", "normalizationArithmetic")}
    if overrides:
        if set(overrides) - set(result):
            raise ValueError("unknown MLX recipe fields")
        result.update(overrides)
    if any(result[key] != value for key, value in fixed.items()):
        raise ValueError("unsupported MLX recipe semantics")
    for key in ("horizon", "minibatchSize", "epochs"):
        if type(result[key]) is not int or result[key] < 1:
            raise ValueError(f"{key} must be a positive integer")
    widths = result["hiddenSizes"]
    if not isinstance(widths, list) or not widths or any(type(n) is not int or n < 1 for n in widths):
        raise ValueError("hiddenSizes must contain positive integers")
    for key in ("gamma", "gaeLambda", "clipRange", "learningRateStart", "learningRateEnd",
                "entropyStart", "valueCoefficient", "maxGradNorm", "adamEpsilon",
                "logStdMax", "clipObservation", "normalizationEpsilon"):
        if isinstance(result[key], bool) or not isinstance(result[key], (int, float)) or not math.isfinite(result[key]):
            raise ValueError(f"{key} must be finite")
        if key != "logStdMax" and result[key] < 0:
            raise ValueError(f"{key} must be nonnegative")
    if not 0 <= result["gamma"] <= 1 or not 0 <= result["gaeLambda"] <= 1 or not 0 < result["clipRange"] < 1:
        raise ValueError("invalid discount or PPO clip range")
    for key in ("learningRateStart", "learningRateEnd", "maxGradNorm", "adamEpsilon", "clipObservation", "normalizationEpsilon"):
        if result[key] <= 0:
            raise ValueError(f"{key} must be positive")
    if spec is not None:
        steps, envs = spec["steps"], spec["envs"]
        if type(steps) is not int or type(envs) is not int or steps < 1 or envs < 1:
            raise ValueError("training steps and envs must be positive integers")
        result["horizon"] = min(result["horizon"], (steps + envs - 1) // envs)
        batch = result["horizon"] * envs
        result["minibatchSize"] = min(result["minibatchSize"], batch)
        while batch % result["minibatchSize"]:
            result["minibatchSize"] -= 1
    return result


def advantages(rewards, values, dones, last_values, gamma, gae_lambda):
    """GAE with transition-t done flags and already-bootstrapped timeout rewards.

    ``dones[t]`` cuts both value and advantage propagation into auto-reset states.
    Timeouts must first add gamma times the value of their terminal observation.
    """
    rewards, values = np.asarray(rewards), np.asarray(values)
    dones = np.asarray(dones, dtype=bool)
    if rewards.ndim != 2 or values.shape != rewards.shape or dones.shape != rewards.shape:
        raise ValueError("GAE requires matching [time, env] arrays")
    following = np.asarray(last_values)
    if following.shape != rewards.shape[1:]:
        raise ValueError("GAE final values require one value per environment")
    output = np.empty_like(rewards, dtype=np.float32)
    tail = np.zeros_like(following)
    for t in range(len(rewards) - 1, -1, -1):
        alive = ~dones[t]
        delta = rewards[t] + gamma * following * alive - values[t]
        tail = delta + gamma * gae_lambda * alive * tail
        output[t] = tail
        following = values[t]
    return output, output + values


def timeout_rewards(rewards, dones, infos, value_of):
    """Bootstrap only truncated, nonterminated transitions using normalized terminals."""
    result = np.asarray(rewards, dtype=np.float32).copy()
    for index, done in enumerate(dones):
        if done and infos[index].get("TimeLimit.truncated", False):
            if "terminal_observation" not in infos[index]:
                raise ValueError("timeout is missing terminal_observation")
            result[index] += value_of(infos[index]["terminal_observation"])
    return result


def normalize_observations(observations, mean, variance, clip, epsilon):
    """Match VecNormalize: float64 statistics arithmetic, then float32 output."""
    mean = np.asarray(mean, np.float64)
    std = np.sqrt(np.asarray(variance, np.float64) + epsilon)
    normalized = np.clip((np.asarray(observations, np.float32) - mean) / std, -clip, clip)
    return normalized.astype(np.float32)


def _finite(value, label):
    if not np.isfinite(np.asarray(value)).all():
        raise ValueError(f"non-finite {label}")


def _atomic_json(path, value):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".mlx-", delete=False) as stream:
        temporary = Path(stream.name)
        try:
            json.dump(value, stream, allow_nan=False)
            stream.write("\n")
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def export_actor(path, layers, mean, variance, config, reference, observations=None):
    """Atomically export only after CPU ORT matches the frozen raw-input actor.

    ``layers`` contains (weight[out,in], bias[out]) pairs. ``reference`` returns
    deterministic raw means for a float32 [1,61] observation, without sampling.
    """
    import onnx
    from onnx import helper, numpy_helper, TensorProto
    import onnxruntime as ort

    if np.asarray(mean).shape != (61,) or np.asarray(variance).shape != (61,):
        raise ValueError("normalizer must contain 61 observation statistics")
    if np.any(np.asarray(variance) < 0):
        raise ValueError("normalizer variance must be nonnegative")
    std = np.sqrt(np.asarray(variance, np.float64) + config["normalizationEpsilon"])
    constants = {"mean": np.asarray(mean, np.float64), "std": std,
                 "low": np.array(-config["clipObservation"], np.float64),
                 "high": np.array(config["clipObservation"], np.float64)}
    nodes = [helper.make_node("Cast", ["obs"], ["obs_double"], to=TensorProto.DOUBLE),
             helper.make_node("Sub", ["obs_double", "mean"], ["centered"]),
             helper.make_node("Div", ["centered", "std"], ["scaled"]),
             helper.make_node("Clip", ["scaled", "low", "high"], ["normalized_double"]),
             helper.make_node("Cast", ["normalized_double"], ["normalized"], to=TensorProto.FLOAT)]
    source, width = "normalized", 61
    for index, (weight, bias) in enumerate(layers):
        weight, bias = np.asarray(weight, np.float32), np.asarray(bias, np.float32)
        if weight.ndim != 2 or weight.shape[1] != width or bias.shape != (weight.shape[0],):
            raise ValueError("invalid actor layer dimensions")
        width = weight.shape[0]
        constants[f"w{index}"], constants[f"b{index}"] = weight, bias
        final = index == len(layers) - 1
        target = "actions" if final else f"linear{index}"
        nodes.append(helper.make_node("Gemm", [source, f"w{index}", f"b{index}"], [target], transB=1))
        if not final:
            source = f"elu{index}"
            nodes.append(helper.make_node("Elu", [target], [source], alpha=1.0))
    if width != 14 or not layers:
        raise ValueError("actor output must contain fourteen raw means")
    for name, value in constants.items():
        _finite(value, name)
    graph = helper.make_graph(nodes, "dsh-mlx-actor", [helper.make_tensor_value_info("obs", TensorProto.FLOAT, [1, 61])],
                              [helper.make_tensor_value_info("actions", TensorProto.FLOAT, [1, 14])],
                              [numpy_helper.from_array(v, k) for k, v in constants.items()])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], ir_version=8)
    onnx.checker.check_model(model)
    data = model.SerializeToString()
    session = ort.InferenceSession(data, providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(0)
    probes = [np.zeros((1, 61), np.float32)]
    probes.extend(rng.normal(0, scale, (1, 61)).astype(np.float32) for scale in (1, 10, 1000))
    probes.extend((constants["mean"] + sign * std * config["clipObservation"])[None].astype(np.float32)
                  for sign in (-1, 1))
    if observations is not None:
        probes.extend(np.asarray(observations, np.float32).reshape(-1, 61)[:8, None, :])
    for probe in probes:
        wanted = np.asarray(reference(probe), np.float32)
        actual = session.run(["actions"], {"obs": probe})[0]
        _finite(wanted, "reference action")
        _finite(actual, "ONNX action")
        np.testing.assert_allclose(actual, wanted, rtol=1e-4, atol=1e-5)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".mlx-onnx-", delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(data)
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def mlx_components(mx, nn, config):
    """Build MLX classes after worker creation; injectable modules support unit tests."""
    class ActorCritic(nn.Module):
        def __init__(self):
            super().__init__()
            widths = [61, *config["hiddenSizes"]]
            self.actor = [nn.Linear(a, b) for a, b in zip(widths, widths[1:] + [14])]
            self.critic = [nn.Linear(a, b) for a, b in zip(widths, widths[1:] + [1])]
            self.log_std = mx.full((14,), config["logStdMax"])

        def actor_mean(self, x):
            for layer in self.actor[:-1]:
                x = nn.elu(layer(x))
            return self.actor[-1](x)

        def __call__(self, x):
            value = x
            for layer in self.critic[:-1]:
                value = nn.elu(layer(value))
            return self.actor_mean(x), self.critic[-1](value).squeeze(-1)

    def log_probability(actions, mean, log_std):
        z = (actions - mean) * mx.exp(-log_std)
        return mx.sum(-0.5 * z * z - log_std - 0.5 * math.log(2 * math.pi), axis=-1)

    def loss(model, obs, actions, old_logp, targets, adv, entropy_coefficient):
        mean, value = model(obs)
        ratio = mx.exp(log_probability(actions, mean, model.log_std) - old_logp)
        if adv.size > 1:
            adv = (adv - mx.mean(adv)) / (mx.sqrt(mx.mean(mx.square(adv - mx.mean(adv)))) + 1e-8)
        surrogate = mx.minimum(ratio * adv, mx.clip(ratio, 1 - config["clipRange"], 1 + config["clipRange"]) * adv)
        entropy = mx.sum(model.log_std + 0.5 * (1 + math.log(2 * math.pi)))
        return -mx.mean(surrogate) + config["valueCoefficient"] * mx.mean(mx.square(value - targets)) - entropy_coefficient * entropy

    return ActorCritic, log_probability, loss


class TrainingCancelled(KeyboardInterrupt):
    """A process signal cancelled training before completion publication."""


def _close_workers(raw, interrupted):
    if not interrupted:
        raw.close()
        return
    # A killed worker cannot release ForkVecEnv's pending-step semaphore.
    for process in raw.processes:
        if process.is_alive():
            process.terminate()
    for process in raw.processes:
        process.join(timeout=1)
        if process.is_alive():
            process.kill()
            process.join()
    for remote in raw.remotes:
        remote.close()


def train(path: Path, spec: dict, make_env, snapshot_steps: int, learner_recipe=None) -> None:
    """Train on Metal and publish verified ONNX; raise on interruption or failure.

    ``make_env(behavior_id, rank, seed, weight_overrides)`` supplies a factory.
    Numeric snapshots are inspection artifacts, not resumable optimizer state.
    Executed steps round up by at most envs-1 to complete a vector step.
    """
    if spec.get("backend") != "mlx":
        raise ValueError("MLX learner requires the explicitly selected mlx backend")
    if type(snapshot_steps) is not int or snapshot_steps < 1:
        raise ValueError("snapshot_steps must be a positive integer")
    config = recipe(spec, learner_recipe)
    if "mlx.core" in sys.modules or "torch" in sys.modules:
        raise RuntimeError("MLX training requires a fresh process: fork workers before importing MLX or Torch")
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    if (path / "policy.onnx").exists():
        raise ValueError("MLX training cannot overwrite an existing final policy")
    seed = spec["seed"]
    random.seed(seed)
    np.random.seed(seed)
    from microduck_local.vec_env import make_vec_env, as_sb3_vec_env
    raw = make_vec_env([make_env(spec["behaviorId"], rank, seed, spec["weights"] or None)
                        for rank in range(spec["envs"])], backend="fork")
    previous = {}
    success = False
    started = time.monotonic()
    try:
        def cancel(signum, frame):
            raise TrainingCancelled(f"MLX training cancelled by signal {signum}")
        for sig in (signal.SIGTERM, signal.SIGINT):
            previous[sig] = signal.signal(sig, cancel)
        import mlx.core as mx
        import mlx.nn as nn
        import mlx.optimizers as optim
        from mlx.utils import tree_flatten
        if not mx.metal.is_available():
            raise RuntimeError("MLX GPU requires an available Apple Metal device; CPU fallback is disabled")
        mx.set_default_device(mx.gpu)
        mx.random.seed(seed)
        from stable_baselines3.common.vec_env import VecNormalize, VecMonitor
        env = VecNormalize(VecMonitor(as_sb3_vec_env(raw)), norm_obs=True, norm_reward=False,
                           clip_obs=config["clipObservation"], epsilon=config["normalizationEpsilon"])
        ActorCritic, log_probability, loss = mlx_components(mx, nn, config)
        model = ActorCritic()
        optimizer = optim.Adam(config["learningRateStart"], eps=config["adamEpsilon"])
        gradient = nn.value_and_grad(model, loss)
        mx.eval(model.parameters())
        _atomic_json(path / "learner-recipe.json", config)
        obs = env.reset()
        completed, snapshots, next_snapshot = 0, 0, snapshot_steps
        episodes = deque(maxlen=100)

        def snapshot(target):
            mean, variance = env.obs_rms.mean.copy(), env.obs_rms.var.copy()
            layers = [(np.asarray(layer.weight), np.asarray(layer.bias)) for layer in model.actor]
            def reference(raw_obs):
                # Snapshot/export is synchronous: no env step or RMS update can occur here.
                # Validate against the training implementation, not the export helper.
                value = model.actor_mean(mx.array(env.normalize_obs(raw_obs)))
                mx.eval(value)
                return np.asarray(value)
            export_actor(target, layers, mean, variance, config, reference, env.get_original_obs())
            arrays = {name: np.asarray(value) for name, value in tree_flatten(model.parameters())}
            arrays.update(obs_mean=mean, obs_variance=variance, obs_count=np.array(env.obs_rms.count))
            with tempfile.NamedTemporaryFile(dir=path, prefix=".mlx-weights-", delete=False) as stream:
                temporary = Path(stream.name)
                try:
                    np.savez(stream, **arrays)
                except BaseException:
                    temporary.unlink(missing_ok=True)
                    raise
            try:
                temporary.replace(path / "weights.npz")
            finally:
                temporary.unlink(missing_ok=True)

        while completed < spec["steps"]:
            rollout_start = time.monotonic()
            horizon = min(config["horizon"], (spec["steps"] - completed + spec["envs"] - 1) // spec["envs"])
            rows = []
            for _ in range(horizon):
                _finite(obs, "observations")
                mean, value = model(mx.array(obs))
                action = mean + mx.exp(model.log_std) * mx.random.normal(mean.shape)
                logp = log_probability(action, mean, model.log_std)
                mx.eval(action, value, logp)
                action_np = np.asarray(action)
                _finite(action_np, "sampled actions")
                new_obs, rewards, dones, infos = env.step(action_np)
                for info in infos:
                    if "episode" in info:
                        episodes.append(info["episode"])
                def terminal_value(terminal):
                    _, v = model(mx.array(np.asarray(terminal, np.float32)[None]))
                    mx.eval(v)
                    return config["gamma"] * float(v.item())
                adjusted = timeout_rewards(rewards, dones, infos, terminal_value)
                _finite(adjusted, "rewards")
                rows.append((obs.copy(), action_np.copy(), np.asarray(logp).copy(), np.asarray(value).copy(), adjusted, dones.copy()))
                obs = new_obs
                completed += spec["envs"]
            _, last_value = model(mx.array(obs))
            mx.eval(last_value)
            observations, actions, logps, values, rewards, dones = (np.stack(parts) for parts in zip(*rows))
            adv, targets = advantages(rewards, values, dones, np.asarray(last_value), config["gamma"], config["gaeLambda"])
            _finite(targets, "value targets")
            batch = [mx.array(x.reshape((-1, *x.shape[2:]))) for x in (observations, actions, logps, targets, adv)]
            rollout_seconds = time.monotonic() - rollout_start
            update_start = time.monotonic()
            fraction = max(0, 1 - (completed - horizon * spec["envs"]) / spec["steps"])
            optimizer.learning_rate = config["learningRateEnd"] + (config["learningRateStart"] - config["learningRateEnd"]) * fraction
            for _ in range(config["epochs"]):
                indices = np.random.permutation(horizon * spec["envs"])
                for start in range(0, len(indices), config["minibatchSize"]):
                    selected = mx.array(indices[start:start + config["minibatchSize"]])
                    cost, grads = gradient(model, *(x[selected] for x in batch), config["entropyStart"] * fraction)
                    grads, norm = optim.clip_grad_norm(grads, config["maxGradNorm"])
                    mx.eval(cost, norm)
                    _finite(np.asarray(cost), "PPO loss")
                    _finite(np.asarray(norm), "gradient norm")
                    optimizer.update(model, grads)
                    model.log_std = mx.minimum(model.log_std, config["logStdMax"])
                    mx.eval(model.parameters(), optimizer.state)
            for name, value in tree_flatten(model.parameters()):
                _finite(np.asarray(value), name)
            update_seconds = time.monotonic() - update_start
            if completed >= next_snapshot:
                snapshot(path / "live.onnx")
                snapshots += 1
                next_snapshot = completed + snapshot_steps
            progress = {"steps": completed, "total": spec["steps"], "elapsed_s": time.monotonic() - started,
                        "ep_rew": float(np.mean([e["r"] for e in episodes])) if episodes else 0.0,
                        "ep_len": float(np.mean([e["l"] for e in episodes])) if episodes else 0.0,
                        "snapshots": snapshots, "phase": "update", "rollout_s": rollout_seconds,
                        "update_s": update_seconds, "rollout_steps": horizon,
                        "sps": horizon * spec["envs"] / max(rollout_seconds + update_seconds, 1e-9)}
            with (path / "progress.jsonl").open("a") as stream:
                stream.write(json.dumps(progress, allow_nan=False) + "\n")
        snapshot(path / "live.onnx")
        snapshot(path / "policy.onnx")
        progress.update(phase="completed", done=True, snapshots=snapshots + 1,
                        elapsed_s=time.monotonic() - started)
        with (path / "progress.jsonl").open("a") as stream:
            stream.write(json.dumps(progress, allow_nan=False) + "\n")
        success = True
    finally:
        try:
            _close_workers(raw, not success)
        except BaseException:
            success = False
            _close_workers(raw, True)
            raise
        finally:
            if not success:
                (path / "policy.onnx").unlink(missing_ok=True)
            for sig, handler in previous.items():
                signal.signal(sig, handler)
