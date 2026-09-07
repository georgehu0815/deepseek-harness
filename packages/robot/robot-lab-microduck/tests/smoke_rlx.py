"""Opt-in bounded RLX bridge smoke; outputs are integration evidence, not a skill."""
import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--rlx-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dance", action="store_true", help="Exercise frozen dance assessment and private controller baselines")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False, mode=0o700)
    bridge = Path(__file__).parents[1] / "python/bridge.py"
    limits = {"maxClipSeconds": 120, "maxClipKeys": 512, "maxTrainingSteps": 100,
              "maxEnvs": 2, "maxRewardWeight": 100, "snapshotSteps": 2,
              "maxSimulationSteps": 1500, "maxEvaluationEpisodes": 2,
              "minStudioBpm": 40, "maxStudioBpm": 200, "studioBeatChoices": [16, 32],
              "studioBlockBeatChoices": [4, 8, 16, 32], "maxProjectBlocks": 8, "maxProjects": 10,
              "rlxSourceRoot": str(args.rlx_source.resolve()),
              "rlxPpo": {"horizon": 2, "numMinibatches": 1, "epochs": 1, "learningRate": 0.0003,
                         "gamma": 0.99, "gaeLambda": 0.95, "normalizeAdvantages": True,
                         "clipCoefficient": 0.2, "clipValueLoss": True, "entropyCoefficient": 0.01,
                         "valueCoefficient": 1.0, "maxGradNorm": 0.5, "observationClip": 10.0,
                         "normalizationEpsilon": 1e-8, "minimumEpisodeSeconds": 0.04}}
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "OMP_NUM_THREADS": "1",
           "OPENBLAS_NUM_THREADS": "1", "MKL_NUM_THREADS": "1", "VECLIB_MAXIMUM_THREADS": "1"}

    def request(value, label):
        result = subprocess.run([sys.executable, "-B", str(bridge), "--source", str(args.source),
                                 "--root", str(args.output)], input=json.dumps({"limits": limits, "request": value}),
                                text=True, capture_output=True, env=env, timeout=180)
        (args.output / (label + ".stderr.txt")).write_text(result.stderr)
        if result.returncode:
            raise RuntimeError(f"{label} exited {result.returncode}: {result.stderr[-6000:]}")
        response = json.loads(result.stdout)
        (args.output / (label + ".json")).write_text(json.dumps(response, indent=2) + "\n")
        return response

    readiness = request({"operation": "readiness", "backend": "rlx"}, "readiness")["readiness"]
    assert readiness["backends"]["rlx"]["available"], readiness
    catalog = request({"operation": "studio"}, "studio")["catalog"]
    project = request({"operation": "save_project", "recipe": {
        "projectId": None, "name": "RLX smoke head bob", "profileId": "microduck", "templateId": "head-bob",
        "templateVersion": 1, "parameters": {"bpm": 101, "beats": 16, "moveSize": 0.2},
        "music": {"version": 1, "style": "electronic", "bpm": 101, "beats": 16, "seed": 1}}}, "project")["project"]
    run_id = "run-" + str(uuid.uuid4())
    spec = {"name": "rlx-smoke", "backend": "rlx", "behaviorId": "imitate", "steps": 4, "envs": 2,
            "seed": 1, "actuator": "bam", "weights": {"travel": 0}, "clip": None,
            "projectRevisionId": project["id"]}
    assessment = {"episodes": 1, "stepsPerEpisode": 1500 if args.dance else 4, "seed": 3,
                  "maxTerminations": 0, "minMeanUprightFraction": 0}
    if args.dance:
        names = [joint["name"] for joint in catalog["profiles"][0]["joints"]]
        # Explicit integration-test thresholds, not a qualified dance preset.
        assessment["dance"] = {"version": 1, "requiredCycles": 2, "minPassedEpisodeFraction": 1,
                               "maxJointRmseRad": [0.35] * 14, "maxRootOrientationRmseRad": 0.5,
                               "movingJointIndices": [names.index("neck_pitch"), names.index("head_pitch")],
                               "minReferenceExcursionRad": 0.002, "minAmplitudeRatio": 0.5,
                               "maxAmplitudeRatio": 2.0, "minReferenceGainRatio": 0.5,
                               "maxHorizontalDriftMeters": 0.2}
    admission = {"evaluation": assessment} if args.dance else {}
    prepared = request({"operation": "prepare_train", "runId": run_id, "spec": spec, **admission}, "prepared")["run"]
    if args.dance:
        assert prepared["dancePlan"]["evaluation"] == assessment
        reference = prepared["dancePlan"]["reference"]
        assert reference["cycleSeconds"] != reference["authoredDurationSeconds"]
        assert reference["blocks"][0]["activeJointIndices"] == assessment["dance"]["movingJointIndices"]
    assert prepared["spec"]["clip"] == project["clip"]
    recipe = prepared["provenance"]["trainer"]["recipe"]
    assert recipe["requestedEpisodeSeconds"] == project["clip"]["duration"]
    assert recipe["episodeSteps"] == math.ceil(recipe["requestedEpisodeSeconds"] / recipe["controlDtSeconds"])
    assert recipe["episodeSeconds"] == recipe["episodeSteps"] * recipe["controlDtSeconds"]
    assert recipe["episodeSeconds"] > recipe["requestedEpisodeSeconds"]
    assert (recipe["episodeSteps"] - 1) * recipe["controlDtSeconds"] < recipe["requestedEpisodeSeconds"]
    run = request({"operation": "train", "runId": run_id}, "trained")["run"]
    assert run["state"] == "completed" and run["progress"]["steps"] == 4
    assert set(run["artifactSha256"]) == {"rlx-artifacts.json"}
    simulation = request({"operation": "simulate", "policyId": run["policyId"], "steps": 4,
                          "seed": 2, "command": [0, 0, 0]}, "simulation")["simulation"]
    assert simulation["policyHash"] == run["policySha256"] and simulation["frames"]
    report = request({"operation": "evaluate", "spec": {"policyId": run["policyId"], **assessment}}, "evaluation")["evaluation"]
    if args.dance:
        assert report["dancePlan"] == prepared["dancePlan"]
        assert report["danceStatus"] in ("passed", "failed", "incomplete")
        assert len(report["episodes"][0]["dance"]["cycles"]) == assessment["dance"]["requiredCycles"]
    assert report["policyHash"] == run["policySha256"]
    blocked = request({"operation": "prepare", "policyId": run["policyId"]}, "hardware-block")
    assert blocked["allowed"] is False
    # A two-step standing episode exercises time-limit bootstrapping inside PPO.
    timeout_id = "run-" + str(uuid.uuid4())
    timeout_spec = {**spec, "behaviorId": "stand", "steps": 8, "weights": {}}
    del timeout_spec["projectRevisionId"]
    request({"operation": "prepare_train", "runId": timeout_id, "spec": timeout_spec}, "timeout-prepared")
    timeout_run = request({"operation": "train", "runId": timeout_id}, "timeout-trained")["run"]
    assert timeout_run["state"] == "completed" and timeout_run["progress"]["steps"] == 8
    assert len(catalog["profiles"][0]["joints"]) == 14
    if args.dance:
        run_baselines(args, limits, run, assessment, env)
    print(json.dumps({"output": str(args.output), "runId": run_id, "timeoutRunId": timeout_id,
                      "policySha256": run["policySha256"], "status": "integration-smoke-passed",
                      "learnedDanceEstablished": False}))


def run_baselines(args, limits, run, assessment, environment):
    """Private same-physics controls, never policy artifacts or kinematic poses."""
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
        os.environ[name] = environment[name]
    sys.path.insert(0, str(Path(__file__).parents[1] / "python"))
    from bridge import Bridge
    provider = Bridge(args.source, args.output, limits)
    loaded = provider.load_policy(run["policyId"])
    from microduck_local import contract as C
    from microduck_local.motion import load_clip
    import numpy as np
    clip = load_clip("reference", provider.path(run["id"]) / "clips")
    quarter_beat = round(60 / run["spec"]["projectSnapshot"]["recipe"]["parameters"]["bpm"] / C.CTRL_DT / 4)
    controls = []
    for name, shift in (("hold-default-v1", None), ("reference-position-v1", 0), ("shifted-reference-position-v1", quarter_beat)):
        def action(observation, step, lag=shift):
            return np.zeros(14, dtype=np.float32) if lag is None else clip.at(step + 1 - lag)[0] - C.DEFAULT_POSE
        episode, _ = provider.rollout(loaded, provider.physics(loaded), assessment["stepsPerEpisode"],
                                      assessment["seed"], [0, 0, 0], False, dance_plan=run["dancePlan"], controller=action)
        controls.append({"controller": {"id": name, "referenceShiftSteps": shift}, "episode": episode})
    evidence = {"kind": "same-simulator-controller-baselines", "notLearnedPolicies": True,
                "dancePlan": run["dancePlan"], "controls": controls}
    (args.output / "controller-baselines.json").write_text(json.dumps(evidence, indent=2, allow_nan=False) + "\n")
    assert controls[0]["episode"]["dance"]["status"] == "failed", "holding default pose must not pass as dance"
    assert controls[2]["episode"]["dance"]["status"] == "failed", "shifted target must not pass unaligned dance criteria"


if __name__ == "__main__":
    main()
