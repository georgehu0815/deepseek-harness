/** Numeric keyframe authoring; it does not claim forward kinematics or physical feasibility. */
import { useState } from 'react'
import type { RobotClip } from '@deepseek-ai/dsh-robot-lab/types'
import css from './RobotLab.module.css'

/**
 * Edit explicit joint targets while retaining the clip's complete immutable payload.
 * @param props - validated motion draft, joint names, and a draft replacement callback.
 * @returns accessible keyframe and joint controls.
 */
export function ClipEditor(props: { clip: RobotClip; jointNames: readonly string[]; onChange: (clip: RobotClip) => void }) {
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, props.clip.keys.length - 1)
  const key = props.clip.keys[index]
  const last = props.clip.keys.at(-1)
  const previous = props.clip.keys.at(-2)
  if (key === undefined || last === undefined || previous === undefined) return <p>Provide at least two keyframes first.</p>
  return <details open>
    <summary>Edit keyframe joints (radians; physical feasibility not verified)</summary>
    <label>Current keyframe<select value={index} onChange={(event) => { setSelected(Number(event.target.value)) }}>
      {props.clip.keys.map((frame, position) => <option key={position} value={position}>Frame {position + 1} · {frame.t} seconds</option>)}
    </select></label>
    <div className={css.joints}>
      {key.joints.map((angle, joint) => <label key={joint}>{props.jointNames[joint] ?? `Joint ${joint + 1}`}
        <input type="number" step="any" value={angle} onChange={(event) => {
          if (event.target.value === '') return
          const value = Number(event.target.value)
          if (!Number.isFinite(value)) return
          props.onChange({ ...props.clip, keys: props.clip.keys.map((frame, position) => position !== index ? frame : {
            ...frame, joints: frame.joints.map((original, slot) => slot === joint ? value : original),
          }) })
        }} />
      </label>)}
    </div>
    <button type="button" onClick={() => {
      const t = last.t + (last.t - previous.t)
      props.onChange({ ...props.clip, duration: t, keys: [...props.clip.keys, { ...last, t, joints: [...last.joints] }] })
      setSelected(props.clip.keys.length)
    }}>Duplicate last frame and extend clip</button>
  </details>
}
