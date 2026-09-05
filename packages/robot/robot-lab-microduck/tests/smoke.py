"""Real selected-backend train/export/reload/evaluation smoke, not a learned-dance claim."""
import argparse
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--backend", choices=("cpu", "mlx"), default="cpu")
    parser.add_argument("--steps", type=int, default=1024)
    parser.add_argument("--inference-python", default=None)
    args = parser.parse_args()
    script = Path(__file__).parents[1] / "python/bridge.py"
    limits = {"maxTrainingSteps": 10000, "maxEnvs": 2, "maxSimulationSteps": 100,
              "maxEvaluationEpisodes": 2, "maxClipKeys": 8, "maxClipSeconds": 10,
              "maxRewardWeight": 100, "snapshotSteps": 512,
              "minStudioBpm": 40, "maxStudioBpm": 200, "studioBeatChoices": [16, 32], "maxProjects": 100,
              "studioBlockBeatChoices": [4, 8, 16, 32], "maxProjectBlocks": 8}
    env = {k: v for k, v in os.environ.items() if not any(s in k.upper() for s in ("KEY", "SECRET", "TOKEN", "PASSWORD"))}
    env.update(PYTHONDONTWRITEBYTECODE="1", OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1", MKL_NUM_THREADS="1", VECLIB_MAXIMUM_THREADS="1")

    def call(request):
        interpreter = args.inference_python if args.inference_python and request["operation"] in ("simulate", "evaluate", "policies", "prepare") else sys.executable
        result = subprocess.run([interpreter, "-B", str(script), "--source", str(args.source), "--root", str(args.output)],
                                input=json.dumps({"request": request, "limits": limits}), text=True,
                                capture_output=True, env=env, timeout=180)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return json.loads(result.stdout)

    ready = call({"operation": "readiness", "backend": args.backend})
    assert ready["readiness"]["backends"][args.backend]["available"], ready
    scene = call({"operation": "scene"})["scene"]
    pose = scene["defaultJoints"]
    left, right = pose.copy(), pose.copy()
    left[7], right[7] = 0.12, -0.12
    clip = {"version": 1, "name": "Head sway smoke", "duration": 2, "loop": True,
            "keys": [{"t": 0, "joints": pose, "rootPitch": 0},
                     {"t": 0.5, "joints": left, "rootPitch": 0},
                     {"t": 1.5, "joints": right, "rootPitch": 0},
                     {"t": 2, "joints": pose, "rootPitch": 0}]}
    spec = {"backend": args.backend, "name": "Head sway smoke", "behaviorId": "imitate", "steps": args.steps, "envs": 2,
            "seed": 17, "actuator": "bam", "weights": {"travel": 0, "no_spin": 0}, "clip": clip}
    run_id = "run-" + str(uuid.uuid4())
    prepared = call({"operation": "prepare_train", "runId": run_id, "spec": spec})
    trained = call({"operation": "train", "runId": run_id})
    assert trained["run"]["state"] == "completed", trained
    restored = call({"operation": "run", "runId": run_id})
    assert restored["run"]["spec"] == spec
    assert restored["run"]["recipeHash"] == prepared["run"]["recipeHash"]
    assert restored["run"]["formatVersion"] == 3
    trainer = restored["run"]["provenance"]["trainer"]
    assert trainer["backend"] == args.backend and trainer["physicsDevice"] == "cpu"
    assert trainer["learnerDevice"] == ("metal" if args.backend == "mlx" else "cpu")
    policy_hash = hashlib.sha256((args.output / "runs" / run_id / "policy.onnx").read_bytes()).hexdigest()
    assert restored["run"]["policySha256"] == policy_hash
    assert restored["run"]["provenance"]["bam"] == prepared["run"]["provenance"]["bam"]
    policy = trained["run"]["policyId"]
    simulation = call({"operation": "simulate", "policyId": policy, "steps": 50, "seed": 123, "command": [0, 0, 0]})
    assert simulation["simulation"]["frames"]
    assert simulation["simulation"]["policyHash"] == policy_hash
    assert simulation["simulation"]["physics"]["bam"] == restored["run"]["provenance"]["bam"]
    assert simulation["simulation"]["physics"]["observationNoise"] is False
    evaluation = call({"operation": "evaluate", "spec": {"policyId": policy, "episodes": 2,
                       "stepsPerEpisode": 50, "seed": 123, "maxTerminations": 0, "minMeanUprightFraction": 0.95}})
    alternate = call({"operation": "evaluate", "spec": {"policyId": policy, "episodes": 1,
                       "stepsPerEpisode": 10, "seed": 456, "maxTerminations": 1, "minMeanUprightFraction": 0}})
    shipped = call({"operation": "evaluate", "spec": {"policyId": "shipped:alpha_stand", "episodes": 1,
                     "stepsPerEpisode": 10, "seed": 123, "maxTerminations": 0, "minMeanUprightFraction": 0.95}})
    reports = [value["evaluation"] for value in (evaluation, alternate, shipped)]
    assert len({report["id"] for report in reports}) == 3
    for report in reports:
        directory = args.output / "evaluations" / report["id"]
        admission = json.loads((directory / "request.json").read_text())
        assert admission["spec"] == report["spec"]
        assert admission["policyHash"] == report["policyHash"]
        assert admission["physics"] == report["physics"]
        assert json.loads((directory / "report.json").read_text()) == report
    policies = call({"operation": "policies"})["policies"]
    assert next(item for item in policies if item["id"] == "shipped:alpha_stand")["verification"] == "evaluated"
    blocked = call({"operation": "prepare", "policyId": policy})
    assert blocked["allowed"] is False and len(blocked["reasons"]) == 2
    args.output.mkdir(parents=True, exist_ok=True)
    evidence = {"readiness": ready, "run": restored, "evaluation": evaluation,
                "alternateEvaluation": alternate, "shippedEvaluation": shipped, "simulation": simulation,
                "deployment": blocked,
                "frameCount": len(simulation["simulation"]["frames"]),
                "claim": f"Integration smoke only. {args.steps} training steps do not prove the requested dance was learned."}
    (args.output / "smoke-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({"runId": run_id, "output": str(args.output), "evaluationPassed": evaluation["evaluation"]["passed"], "frameCount": evidence["frameCount"]}))


if __name__ == "__main__":
    main()
