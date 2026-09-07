"""Versioned control-grid dance measurements; no learner or numeric runtime imports."""
from __future__ import annotations

import json
import math


CRITERIA_FIELDS = {
    "version", "requiredCycles", "minPassedEpisodeFraction", "maxJointRmseRad",
    "maxRootOrientationRmseRad", "movingJointIndices", "minReferenceExcursionRad",
    "minAmplitudeRatio", "maxAmplitudeRatio", "minReferenceGainRatio", "maxHorizontalDriftMeters",
}
EVALUATION_FIELDS = {"episodes", "stepsPerEpisode", "seed", "maxTerminations", "minMeanUprightFraction", "dance"}
VIOLATIONS = {"joint-rmse", "root-rmse", "horizontal-drift", "amplitude-ratio", "reference-gain"}


def _number(value, name, low, high, integer=False, positive=False):
    if (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
            or not low <= value <= high or (integer and type(value) is not int) or (positive and value <= 0)):
        raise ValueError(f"invalid dance {name}")
    return value


def validate_evaluation(evaluation, limits):
    """Validate all explicit pre-training criteria without introducing defaults."""
    if not isinstance(evaluation, dict) or set(evaluation) != EVALUATION_FIELDS:
        raise ValueError("dance evaluation requires exact criteria without policyId")
    n = _number(evaluation["episodes"], "episodes", 1, limits["maxEvaluationEpisodes"], True)
    _number(evaluation["stepsPerEpisode"], "stepsPerEpisode", 1, limits["maxSimulationSteps"], True)
    _number(evaluation["seed"], "seed", 0, 2147483647 - n, True)
    _number(evaluation["maxTerminations"], "maxTerminations", 0, n, True)
    _number(evaluation["minMeanUprightFraction"], "minMeanUprightFraction", 0, 1)
    criteria = evaluation["dance"]
    if (not isinstance(criteria, dict) or set(criteria) != CRITERIA_FIELDS
            or type(criteria["version"]) is not int or criteria["version"] not in (1, 2)):
        raise ValueError("dance requires complete version 1 or 2 criteria")
    _number(criteria["requiredCycles"], "requiredCycles", 1, evaluation["stepsPerEpisode"], True)
    _number(criteria["minPassedEpisodeFraction"], "minPassedEpisodeFraction", 0, 1, positive=True)
    for name in ("minReferenceExcursionRad", "minAmplitudeRatio", "maxAmplitudeRatio", "minReferenceGainRatio"):
        _number(criteria[name], name, 0, float("inf"), positive=True)
    if criteria["maxAmplitudeRatio"] < criteria["minAmplitudeRatio"]:
        raise ValueError("dance amplitude bounds are reversed")
    for name in ("maxRootOrientationRmseRad", "maxHorizontalDriftMeters"):
        _number(criteria[name], name, 0, float("inf"))
    bounds = criteria["maxJointRmseRad"]
    if not isinstance(bounds, list) or len(bounds) != 14:
        raise ValueError("dance joint thresholds require fourteen entries")
    for value in bounds:
        _number(value, "joint RMSE", 0, float("inf"))
    joints = criteria["movingJointIndices"]
    if not isinstance(joints, list) or not joints:
        raise ValueError("dance requires selected moving joints")
    for joint in joints:
        _number(joint, "moving joint", 0, 13, True)
    if len(set(joints)) != len(joints):
        raise ValueError("dance moving joints must be unique")
    return json.loads(json.dumps(evaluation, allow_nan=False))


def _finite_vector(value, size):
    return (isinstance(value, (list, tuple)) and len(value) == size
            and all(type(v) in (int, float) and math.isfinite(v) for v in value))


def target_index(step, count, loop):
    return step % count if loop else min(step, count - 1)


def active_joints(targets, floor):
    """Identify motion using the whole planned interval, not a surviving prefix."""
    if len(targets) < 2:
        return []
    return [joint for joint in range(14)
            if max(row[joint] for row in targets) - min(row[joint] for row in targets) >= floor
            and max(row[joint] for row in targets) > min(row[joint] for row in targets)]


def reference_descriptor(raw_clip, joints, pitch, dt, joint_names, root_body, block_ranges, evaluation, digest):
    """Freeze the actual loaded arrays and their post-step scoring intervals."""
    count = len(joints)
    if (count < 1 or len(pitch) != count or not all(_finite_vector(row, 14) for row in joints)
            or not _finite_vector(pitch, count) or not math.isfinite(dt) or dt <= 0
            or len(joint_names) != 14 or len(set(joint_names)) != 14):
        raise ValueError("invalid runtime dance reference")
    criteria = evaluation["dance"]
    if criteria["requiredCycles"] * count > evaluation["stepsPerEpisode"]:
        raise ValueError("dance evaluation horizon cannot cover required runtime cycles")
    if not raw_clip["loop"] and (criteria["requiredCycles"] != 1 or evaluation["stepsPerEpisode"] != count):
        raise ValueError("nonlooping dance reference requires one cycle and exactly its runtime step count")
    targets = [joints[target_index(k, count, raw_clip["loop"])] for k in range(1, count + 1)]
    active = active_joints(targets, criteria["minReferenceExcursionRad"])
    if not set(criteria["movingJointIndices"]).issubset(active):
        raise ValueError("selected dance joints are inactive on the runtime reference grid")
    blocks = []
    for index, (start, end) in enumerate(block_ranges):
        if not 0 <= start < end <= count:
            raise ValueError("authored dance block has no runtime control samples")
        block_targets = [joints[target_index(k, count, raw_clip["loop"])] for k in range(start + 1, end + 1)]
        blocks.append({"index": index, "startStep": start, "endStep": end,
                       "activeJointIndices": active_joints(block_targets, criteria["minReferenceExcursionRad"])})
    return {"clipSha256": digest(raw_clip), "sampledSha256": digest({"joints": joints, "pitch": pitch}),
            "jointNames": list(joint_names), "rootBody": root_body,
            "rootConvention": "initial-heading-world-up-pitch-v1",
            "authoredDurationSeconds": raw_clip["duration"], "controlDtSeconds": dt,
            "cycleSteps": count, "cycleSeconds": count * dt, "loop": raw_clip["loop"], "blocks": blocks}


def _plan_version(plan):
    """Require the same explicitly supported semantics in the plan and its criteria."""
    if not isinstance(plan, dict):
        raise ValueError("dance plan requires matching version 1 or 2 criteria")
    version, evaluation = plan.get("version"), plan.get("evaluation")
    criteria = evaluation.get("dance") if isinstance(evaluation, dict) else None
    if (type(version) is not int or version not in (1, 2) or not isinstance(criteria, dict)
            or type(criteria.get("version")) is not int or criteria["version"] != version):
        raise ValueError("dance plan requires matching version 1 or 2 criteria")
    return version


def validate_plan_hash(plan, digest):
    _plan_version(plan)
    if digest({k: v for k, v in plan.items() if k != "sha256"}) != plan.get("sha256"):
        raise ValueError("frozen dance plan hash mismatch")


def heading(quaternion):
    """Read initial free-root heading in the world-up frame."""
    if not _finite_vector(quaternion, 4):
        raise ValueError("dance initial root orientation is unavailable")
    norm = math.hypot(*quaternion)
    if norm == 0 or not math.isfinite(norm):
        raise ValueError("dance initial root orientation is invalid")
    w, x, y, z = (v / norm for v in quaternion)
    return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


def root_error(quaternion, pitch, initial_heading):
    if not _finite_vector(quaternion, 4):
        return None
    norm = math.hypot(*quaternion)
    if norm == 0 or not math.isfinite(norm):
        return None
    ch, sh = math.cos(initial_heading / 2), math.sin(initial_heading / 2)
    cp, sp = math.cos(pitch / 2), math.sin(pitch / 2)
    target = (ch * cp, -sh * sp, ch * sp, sh * cp)
    dot = abs(sum(a * b / norm for a, b in zip(quaternion, target)))
    return 2 * math.acos(min(1.0, dot))


def _rms(values):
    return math.sqrt(math.fsum(v * v for v in values) / len(values)) if values else None


def _status(reasons):
    return "failed" if VIOLATIONS.intersection(reasons) else "incomplete" if reasons else "passed"


def episode(plan, samples, joints, pitch, initial_position, initial_quaternion, executed_steps, terminated, truncated):
    """Assess post-step samples without padding or time alignment.

    Both versions record observed-subset metrics. V2 uses whole-window RMSE lower
    bounds and requires full measurement coverage before movement can fail.
    """
    version = _plan_version(plan)
    reference, criteria = plan["reference"], plan["evaluation"]["dance"]
    if executed_steps < plan["evaluation"]["stepsPerEpisode"] and not terminated and not truncated:
        raise ValueError("short dance rollout has no terminal or truncation evidence")
    count, loop = reference["cycleSteps"], reference["loop"]
    initial_heading = heading(initial_quaternion)
    if not _finite_vector(initial_position, 3):
        raise ValueError("dance initial root position is unavailable")
    by_step = {}
    for sample in samples:
        step = sample["step"]
        if type(step) is not int or not 1 <= step <= executed_steps or step in by_step:
            raise ValueError("dance samples require unique executed control steps")
        by_step[step] = sample

    def window(index, start, end):
        rows = [by_step[k] for k in range(start + 1, end + 1) if k in by_step]
        expected = end - start
        elapsed = max(0, min(end, executed_steps) - start)
        reasons = []
        targets = [joints[target_index(k, count, loop)] for k in range(start + 1, end + 1)]
        active = active_joints(targets, criteria["minReferenceExcursionRad"])
        joint_rows = [row for row in rows if _finite_vector(row.get("joints"), 14)
                      and _finite_vector(row.get("rootPosition"), 3)
                      and root_error(row.get("rootQuaternion"), pitch[target_index(row["step"], count, loop)], initial_heading) is not None]
        joint_rmse = ([_rms([row["joints"][j] - joints[target_index(row["step"], count, loop)][j]
                            for row in joint_rows]) for j in range(14)] if joint_rows else None)
        orientation = [root_error(row["rootQuaternion"], pitch[target_index(row["step"], count, loop)], initial_heading)
                       for row in joint_rows]
        orientation_rmse = _rms(orientation)
        positions = [row["rootPosition"] for row in joint_rows]
        drift = max((math.hypot(pos[0] - initial_position[0], pos[1] - initial_position[1]) for pos in positions), default=None)
        valid = len(joint_rows) == len(rows)
        if len(joint_rows) != elapsed or not rows:
            reasons.append("missing-measurements")
        complete = (expected > 0 and elapsed == expected and len(rows) == expected and valid
                    and not (terminated and start < executed_steps <= end))
        if not complete:
            reasons.append("incomplete-window")
        amplitude, gain = [None] * 14, [None] * 14
        for j in active:
            actual = [row["joints"][j] for row in joint_rows]
            target = [joints[target_index(row["step"], count, loop)][j] for row in joint_rows]
            if len(target) < 2:
                if j in criteria["movingJointIndices"]:
                    reasons.append("missing-measurements")
                continue
            amean, rmean = math.fsum(actual) / len(actual), math.fsum(target) / len(target)
            a, r = [v - amean for v in actual], [v - rmean for v in target]
            denominator = math.fsum(v * v for v in r)
            if denominator == 0:
                if j in criteria["movingJointIndices"]:
                    reasons.append("missing-measurements")
                continue
            amplitude[j] = math.sqrt(math.fsum(v * v for v in a) / denominator)
            gain[j] = math.fsum(x * y for x, y in zip(a, r)) / denominator
        # This factor is at most one; compare finite RMSE without squaring it.
        rmse_factor = math.sqrt(len(joint_rows) / expected) if version == 2 and expected > 0 else 1.0
        if joint_rmse is not None and any(v * rmse_factor > bound for v, bound in zip(joint_rmse, criteria["maxJointRmseRad"])):
            reasons.append("joint-rmse")
        if orientation_rmse is not None and orientation_rmse * rmse_factor > criteria["maxRootOrientationRmseRad"]:
            reasons.append("root-rmse")
        if drift is not None and drift > criteria["maxHorizontalDriftMeters"]:
            reasons.append("horizontal-drift")
        if version == 1 or len(joint_rows) == expected:
            for j in set(criteria["movingJointIndices"]).intersection(active):
                if amplitude[j] is not None and not criteria["minAmplitudeRatio"] <= amplitude[j] <= criteria["maxAmplitudeRatio"]:
                    reasons.append("amplitude-ratio")
                if gain[j] is not None and gain[j] < criteria["minReferenceGainRatio"]:
                    reasons.append("reference-gain")
        if orientation_rmse is None or joint_rmse is None or drift is None:
            reasons.append("missing-measurements")
        reasons = sorted(set(reasons))
        return {"index": index, "steps": elapsed, "measuredSteps": len(joint_rows), "complete": complete, "jointRmseRad": joint_rmse,
                "rootOrientationRmseRad": orientation_rmse, "amplitudeRatio": amplitude,
                "referenceGainRatio": gain, "maxHorizontalDriftMeters": drift,
                "status": _status(reasons), "reasons": reasons}

    cycles = []
    for index in range(criteria["requiredCycles"]):
        offset = index * count
        cycle = window(index, offset, offset + count)
        cycle["blocks"] = [window(block["index"], offset + block["startStep"], offset + block["endStep"])
                           for block in reference["blocks"]]
        cycle["reasons"] = sorted(set(cycle["reasons"]).union(*(set(block["reasons"]) for block in cycle["blocks"])))
        cycle["status"] = _status(cycle["reasons"])
        cycles.append(cycle)
    reasons = set().union(*(set(cycle["reasons"]) for cycle in cycles))
    if terminated:
        reasons.add("terminated")
    if truncated and executed_steps < plan["evaluation"]["stepsPerEpisode"]:
        reasons.add("early-truncated")
    status = ("failed" if terminated or "early-truncated" in reasons else _status(reasons))
    return {"completedCycles": executed_steps // count, "terminated": bool(terminated), "truncated": bool(truncated),
            "cycles": cycles, "status": status, "reasons": sorted(reasons)}


def evaluation_status(episodes, criteria):
    """Bound the possible pass fraction when some episodes are incomplete."""
    total = len(episodes)
    passed = sum(ep["status"] == "passed" for ep in episodes)
    incomplete = sum(ep["status"] == "incomplete" for ep in episodes)
    fraction = criteria["minPassedEpisodeFraction"]
    if total and passed / total >= fraction:
        return "passed"
    if total and (passed + incomplete) / total < fraction:
        return "failed"
    return "incomplete"
