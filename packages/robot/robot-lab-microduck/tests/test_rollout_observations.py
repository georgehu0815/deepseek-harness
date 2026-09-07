"""Opt-in four-step CPU observation-cadence proof, without policy loading or training."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("robot_observation_bridge", Path(__file__).parents[1] / "python/bridge.py")
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


@unittest.skipUnless(os.environ.get("ROBOT_BRIDGE_SOURCE"), "set ROBOT_BRIDGE_SOURCE for installed CPU MuJoCo proof")
class RealRolloutObservationTests(unittest.TestCase):
    def test_shipped_commands_preserve_public_observations_and_joint_velocity_lag(self):
        source = Path(os.environ["ROBOT_BRIDGE_SOURCE"])
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ), patch.object(sys, "path", sys.path[:]):
            provider = bridge.Bridge(source, Path(temporary), {})
            import numpy as np
            from microduck_local import walk_env

            environments = []

            class ObservedEnvironment(walk_env.MicroduckWalkEnv):
                def __init__(env, *args, **kwargs):
                    env.observation_calls = 0
                    env.returned = []
                    env.step_commands = []
                    env.closed = False
                    super().__init__(*args, **kwargs)
                    environments.append(env)

                def _get_obs(env):
                    env.observation_calls += 1
                    return super()._get_obs()

                def _record(env, result):
                    obs = result[0]
                    env.returned.append((obs, obs.copy(), env._joint_vel().copy()))
                    return result

                def reset(env, **kwargs):
                    return env._record(super().reset(**kwargs))

                def step(env, action):
                    env.step_commands.append(env.twist_cmd.copy())
                    return env._record(super().step(action))

                def close(env):
                    try:
                        super().close()
                    finally:
                        env.closed = True

            commands = [[0.1, -0.2, 0.3], [-0.1, 0.2, -0.3], [0.0, 0.0, 0.0], [0.2, 0.1, -0.2]]
            command = commands[0][:]
            observed = []

            def controller(obs, step):
                observed.append(obs.copy())
                if step + 1 < len(commands):
                    command[:] = commands[step + 1]
                return np.zeros(14, dtype=np.float32)

            with patch.object(walk_env, "MicroduckWalkEnv", ObservedEnvironment):
                physics = provider.physics((None, None))
                report, frames = provider.rollout((None, None, None, None), physics, 4, 23,
                                                  command, False, controller=controller)
            self.assertEqual(len(environments), 1)
            env = environments[0]
            self.assertTrue(env.closed)
            self.assertEqual((report["steps"], report["terminated"], frames), (4, False, []))
            self.assertEqual(env.observation_calls, 5)
            self.assertEqual(len(observed), 4)
            for step, obs in enumerate(observed):
                original, snapshot, current_velocity = env.returned[step]
                expected = snapshot.copy()
                expected[48:51] = commands[step]
                np.testing.assert_array_equal(obs, expected)
                np.testing.assert_array_equal(env.step_commands[step], np.asarray(commands[step], dtype=np.float32))
                if step:
                    np.testing.assert_array_equal(obs[20:34], env.returned[step - 1][2])
            self.assertTrue(any(np.any(obs[20:34] != env.returned[step][2])
                                for step, obs in enumerate(observed) if step))
            for original, snapshot, _ in env.returned:
                np.testing.assert_array_equal(original, snapshot)
            print("CPU observation proof: 4 fixed-zero-action steps; 5 observation updates; "
                  "nonzero velocity lag preserved; environment closed; no policy loaded")


if __name__ == "__main__":
    unittest.main()
