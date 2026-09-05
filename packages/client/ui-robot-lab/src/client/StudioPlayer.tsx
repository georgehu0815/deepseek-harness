/** A synchronized target/physics player with explicitly sourced motion indicators. */
import { Component, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { RobotFrame } from '@deepseek-ai/dsh-robot-lab/types'
import type { StudioPlayerProps } from './studio-props.ts'
import { RobotViewer } from './RobotViewer.tsx'
import { playbackFrame } from './playback-frame.ts'
import { PLAYBACK_RATES } from './playback-transport.ts'
import { routinePosition } from './routine-position.ts'
import { CAMERA_VIEWS, SURFACE_PRESETS } from './viewer-presets.ts'
import { MAX_ROSTER_FILE_BYTES } from './roster-file.ts'
import css from './RobotLab.module.css'

const EMPTY_FRAMES: RobotFrame[] = []

class ViewerBoundary extends Component<{ children: ReactNode; pause: () => void }, { error: string | null }> {
  override state: { error: string | null } = { error: null }
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : String(error) } }
  override componentDidCatch() { this.props.pause() }
  override render() { return this.state.error === null ? this.props.children : <p role="alert">Renderer unavailable: {this.state.error}</p> }
}

/**
 * Show the grid before any recording is loaded, then play immutable motion with the shared session transport.
 * @param props - the session-scoped player registration's derived shares.
 * @returns the real 3D stage and timestamp-aligned measured indicators.
 */
export function StudioPlayer(props: StudioPlayerProps) {
  const [fileError, setFileError] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const lab = props.useLab(value => value)
  const view = props.useStore(value => value)
  const playback = props.usePlayback(value => value)
  const group = lab.groupRecording
  const track = group?.tracks.find(item => item.member.id === view.selectedDuck) ?? group?.tracks[0]
  const recording = track?.simulation ?? lab.recording
  const project = track === undefined ? lab.recordingProject : lab.runs.find(item =>
    item.policyId === track.simulation.policyId && item.policySha256 === track.simulation.policyHash)?.spec.projectSnapshot ?? null
  const busy = lab.busy !== null || loadingFile
  const assigned = view.ducks.filter(duck => lab.policies.some(policy =>
    policy.id === duck.policyId && policy.runtimeCompatibility.available)).length
  const groupChanged = group !== null && (group.tracks.length !== view.ducks.length || group.tracks.some(({ member }, index) => {
    const duck = view.ducks[index]
    return duck === undefined || duck.id !== member.id || duck.name !== member.name || duck.policyId !== member.policyId
      || duck.projectRevisionId !== member.projectRevisionId || duck.x !== member.x || duck.z !== member.z
  }))
  const reference = recording?.mode === 'kinematic-reference'
  const playing = playback.state === 'playing' || playback.state === 'starting'
  const frame = recording === null ? undefined : playbackFrame(recording.frames, playback.time)
  const last = recording?.frames.at(-1)
  const beat = project === null ? null : Math.min(project.recipe.parameters.beats - 1,
    Math.floor(playback.time * project.recipe.parameters.bpm / 60))
  const position = project === null ? null : routinePosition(project.blocks, project.recipe.parameters.bpm, playback.time)
  const joint = view.selectedJoint
  const telemetry = frame?.telemetry
  const jointVelocity = telemetry?.jointVelocity?.[joint]
  const jointTorque = telemetry?.actuatorTorque?.[joint]
  const profile = project?.profile ?? lab.catalog?.profiles[0]
  const selectedBody = view.selectedBody === null ? undefined : frame?.bodies[view.selectedBody]
  const degrees = (value: number | undefined) => value === undefined ? 'Not recorded' : `${(value * 180 / Math.PI).toFixed(1)}°`
  const standing = lab.policies.find(item => item.id === 'shipped:alpha_stand' && item.runtimeCompatibility.available)
  const surface = SURFACE_PRESETS.find(item => item.id === view.surface)
  useEffect(() => props.pause, [props.pause])
  const firstDuck = view.ducks[0]
  if (firstDuck === undefined) throw new Error('Duck roster must contain at least one member.')
  const selectedDuck = view.ducks.find(item => item.id === view.selectedDuck) ?? firstDuck

  return <section className={css.studio} aria-label="Robot Studio player">
    <header className={css.header}><div><strong>Robot Studio</strong><p>{profile?.label ?? 'MicroDuck'} · Simulation only</p></div>
      <button type="button" aria-pressed={view.expandedViewer} onClick={() => { props.actions.expandedViewer(!view.expandedViewer) }}>{view.expandedViewer ? 'Compact view' : 'Expand view'}</button></header>
    <div className={clsx(css.scene, view.expandedViewer && css.expandedScene)}>
      <span className={css.badge}>{group !== null ? `${group.tracks.length} ducks · Independent group replay` : recording === null ? 'No performance loaded' : reference ? 'Target preview · Not physics-tested' : lab.recordingEvaluation !== null ? 'Evaluation episode · New re-simulation' : 'Recorded simulation · Not live hardware'}</span>
      <ViewerBoundary key={group !== null ? group.tracks.map(item => `${item.member.id}:${item.simulation.policyHash}`).join('|')
        : recording === null ? 'empty-stage' : reference ? recording.projectSha256 : recording.policyHash} pause={props.pause}>
        <RobotViewer scene={lab.scene} frames={lab.recording?.frames ?? EMPTY_FRAMES} playing={playback.state === 'playing'} time={playback.time} readTime={props.readTime}
          surface={view.surface} cameraView={view.cameraView} cameraReset={view.cameraReset} maxDpr={props.maxDpr}
          selectedBody={view.selectedBody} onBodySelect={props.actions.selectedBody} onHidden={props.pause}
          {...(group === null ? {} : { groupTracks: group.tracks })}
          selectedDuck={track?.member.id ?? view.selectedDuck} onDuckSelect={props.actions.selectDuck}
          onTogglePlayback={playing ? props.pause : props.play} />
      </ViewerBoundary>
      <span className={css.stageHint}>Drag to orbit · Scroll to zoom{recording !== null ? ' · Click a part' : ''}{surface?.id === 'studio' ? ' · Grid 10 cm' : ''}</span>
    </div>
    <div className={css.viewerControls}><label>Visual surface<select value={view.surface} onChange={(event) => {
      const next = SURFACE_PRESETS.find(item => item.id === event.target.value); if (next !== undefined) props.actions.surface(next.id)
    }}>{SURFACE_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label>Camera<select value={view.cameraView} onChange={(event) => {
      const next = CAMERA_VIEWS.find(item => item.id === event.target.value); if (next !== undefined) props.actions.cameraView(next.id)
    }}>{CAMERA_VIEWS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <button type="button" onClick={() => { props.actions.resetCamera() }}>Reset view</button>
    {recording === null && <button type="button" disabled={standing === undefined || lab.busy !== null || !lab.readiness?.ready || !lab.readiness.capabilities.simulate.available} onClick={() => {
      if (standing !== undefined) props.execute({ operation: 'simulate', policyId: standing.id, steps: props.simulationSteps, seed: 0, command: [0, 0, 0] })
    }}>Preview standing policy</button>}</div>
    {recording === null && <p className={css.surfaceNotice}>
      Open Micro Duck to choose a move and preview its target here. A target preview is not a trained policy.</p>}
    <p className={css.surfaceNotice}>Visual surface only · Appearance does not change terrain or friction.</p>
    <div className={css.row}>
      <button type="button" disabled={recording === null} onClick={playing ? props.pause : props.play}>{playing ? 'Pause' : playback.mode === 'music' ? 'Play with soundtrack' : 'Play recording'}</button>
      <button type="button" disabled={recording === null} onClick={props.restartPlayback}>Restart</button>
      <label className={css.playerSeek}>Performance time<input aria-label="Performance time" type="range" min="0" max={playback.duration} step="0.02"
        value={playback.time} disabled={recording === null} onChange={(event) => { props.seek(Number(event.target.value)) }} /></label>
      <small>{playback.time.toFixed(2)} / {playback.duration.toFixed(2)} seconds</small>
      <label>Volume<input aria-label="Music volume" type="range" min="0" max="1" step="0.05" value={playback.volume}
        onChange={(event) => { props.volume(Number(event.target.value)) }} /></label>
      <button type="button" aria-pressed={playback.muted} onClick={() => { props.mute(!playback.muted) }}>{playback.muted ? 'Unmute' : 'Mute'}</button>
      <label>Replay speed<select value={playback.rate} onChange={(event) => { props.setPlaybackRate(Number(event.target.value)) }}>
        {PLAYBACK_RATES.map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
      {playback.mode === 'silent' && <small>No soundtrack loaded</small>}
    </div>
    {playback.rate !== 1 && <p className={css.surfaceNotice}>
      Replay only: music tempo and pitch change; saved motion and training do not.</p>}
    {playback.error !== null && <div className={css.row}><p className={css.error} role="alert">{playback.error}</p><button type="button" onClick={props.playWithoutMusic}>Play without music</button></div>}
    <section className={css.roster} aria-label="Duck roster">
      <div className={css.rosterHeading}>
        <div>
          <h2>Your dance group</h2>
          <small>{view.ducks.length} / {props.maxGroupMembers} ducks · {assigned} policies ready</small>
        </div>
        <button type="button" disabled={busy || view.ducks.length >= props.maxGroupMembers} onClick={() => { props.actions.addDuck() }}>+ Add duck</button>
      </div>
      <p>Choose a policy for each MicroDuck, then record the group. Each duck is simulated independently.</p>
      <details className={css.rosterFiles}><summary>Save or load a group</summary>
        <p>Save a group file before refreshing. It contains names, assignments and formation—not policy files or recordings.
          Load it in the same session to resolve trained policies.</p>
        <button type="button" disabled={busy || view.ducks.some(duck => duck.name.trim() === '')} onClick={() => {
          props.saveRoster({ version: 1, members: view.ducks, formation: view.formation, spacing: view.groupSpacing })
        }}>Save group file</button>
        <label>Load group file<input type="file" accept="application/json,.json" disabled={busy || loadingFile} onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file === undefined) return
          setFileError(null)
          if (file.size > MAX_ROSTER_FILE_BYTES) { setFileError('Group file exceeds the 1 MiB limit.'); return }
          setLoadingFile(true)
          void file.text().then((text) => { props.loadRoster(text) }).catch((error: unknown) => {
            setFileError(error instanceof Error ? error.message : String(error))
          }).finally(() => { setLoadingFile(false) })
        }} /></label>
        {loadingFile && <small>Reading group file…</small>}
        {fileError !== null && <p role="alert" className={css.error}>{fileError}</p>}
      </details>
      <div className={css.duckList}>{view.ducks.map((duck) => {
        const policy = lab.policies.find(item => item.id === duck.policyId)
        return <article key={duck.id} className={clsx(css.duckCard, duck.id === selectedDuck.id && css.selectedDuck)} aria-label={`Duck ${duck.id}`}>
          <button type="button" className={css.duckName} aria-pressed={duck.id === selectedDuck.id} onClick={() => { props.actions.selectDuck(duck.id) }}>
            <span aria-hidden="true">♩</span> {duck.name || `Duck ${duck.id}`}</button>
          <label>Policy<select aria-label={`Duck ${duck.id} policy`} value={duck.policyId ?? ''} disabled={busy} onChange={(event) => {
            const chosen = lab.policies.find(item => item.id === event.target.value)
            props.actions.updateDuck(duck.id, { policyId: chosen?.id ?? null })
          }}><option value="">Choose a policy</option>
            {duck.policyId !== null && policy === undefined && <option value={duck.policyId}>Unavailable policy</option>}
            {lab.policies.map(item => <option key={item.id} value={item.id} disabled={!item.runtimeCompatibility.available}>
              {item.name}{item.runtimeCompatibility.available ? '' : ' · Incompatible'}</option>)}</select></label>
          <small>{policy === undefined ? 'Assign a policy to rehearse' : policy.runtimeCompatibility.available ? 'Ready to record · Skill unverified' : policy.runtimeCompatibility.reason}</small>
        </article>
      })}</div>
      <fieldset disabled={busy} className={css.duckEditor}><legend>Manage {selectedDuck.name || `Duck ${selectedDuck.id}`}</legend>
        <label>Duck name<input aria-label="Duck name" maxLength={80} value={selectedDuck.name} onChange={(event) => { props.actions.updateDuck(selectedDuck.id, { name: event.target.value }) }} /></label>
        <label>Training project<select value={selectedDuck.projectRevisionId ?? ''} onChange={(event) => {
          const chosen = lab.projects.find(item => item.id === event.target.value)
          props.actions.updateDuck(selectedDuck.id, { projectRevisionId: chosen?.id ?? null })
        }}><option value="">Choose a saved routine</option>
          {selectedDuck.projectRevisionId !== null && !lab.projects.some(item => item.id === selectedDuck.projectRevisionId)
            && <option value={selectedDuck.projectRevisionId}>Unavailable revision</option>}
          {lab.projects.map(item => <option key={item.id} value={item.id}>{item.recipe.name} · {item.createdAt}</option>)}</select></label>
        <div className={css.rosterActions}>
          <button type="button" disabled={!lab.projects.some(item => item.id === selectedDuck.projectRevisionId) || (view.dance !== null && view.editVersion !== view.savedEditVersion)} onClick={() => {
            const source = lab.projects.find(item => item.id === selectedDuck.projectRevisionId)
            if (source !== undefined) props.actions.trainDuck(selectedDuck.id, source)
          }}>Set up individual training</button>
          <button type="button" disabled={view.ducks.length >= props.maxGroupMembers} onClick={() => { props.actions.duplicateDuck(selectedDuck.id) }}>Duplicate duck</button>
          <button type="button" disabled={view.ducks.length <= 1} onClick={() => { props.actions.removeDuck(selectedDuck.id) }}>Remove duck</button>
        </div>
        <small>Open the Micro Duck tab to train the saved routine, then assign its exported policy here.
          Save any open draft first. Selecting a policy does not fine-tune it.</small>
      </fieldset>
      <div className={css.formationControls}>
        <label>Formation<select value={view.formation} disabled={busy} onChange={(event) => {
          const value = event.target.value
          if (value === 'line' || value === 'grid' || value === 'circle') props.actions.arrangeDucks(value, view.groupSpacing)
        }}><option value="line">Line</option><option value="grid">Grid</option><option value="circle">Circle</option></select></label>
        <label>Spacing (meters)<input type="number" min="0.2" max="3" step="0.1" value={view.groupSpacing} disabled={busy} onChange={(event) => {
          const value = Number(event.target.value)
          if (Number.isFinite(value) && value >= 0.2 && value <= 3) props.actions.arrangeDucks(view.formation, value)
        }} /></label>
        <label>Group recording steps<input type="number" min="1" max="3000"
          value={view.simulationSteps ?? props.simulationSteps} disabled={busy} onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isSafeInteger(value) && value > 0 && value <= 3000) props.actions.simulationSteps(value)
          }} /></label>
      </div>
      <div className={css.rosterActions}>
        <button type="button" className={css.primaryAction} disabled={busy || assigned !== view.ducks.length || !lab.readiness?.ready || !lab.readiness.capabilities.simulate.available}
          onClick={() => { props.simulateGroup(view.ducks, view.simulationSteps ?? props.simulationSteps, 0) }}>{lab.busy === 'simulate_group' ? 'Recording ducks…' : 'Record group dance'}</button>
        <button type="button" disabled={busy} onClick={props.refresh}>Refresh policies</button>
      </div>
      <p>Shared start and playback clock · No inter-duck collisions or learned coordination.
        Formation changes apply when you record again.</p>
      {group !== null && <p>{group.tracks.length} recorded ducks · Replay stops together at {group.duration.toFixed(2)} seconds, the shortest recording. {lab.recordingProject === null ? 'No soundtrack loaded.' : 'Soundtrack follows the first duck; other policies are not retimed.'}</p>}
      {groupChanged && <p className={css.groupChanged}>Roster changed. The stage still shows the last recorded group;
        record again to apply changes.</p>}
    </section>
    {recording !== null && <div className={css.playerInfo}>
      <strong>{position?.label ?? 'Policy replay'}</strong>
      {position !== null && project !== null && <small>
        Move {position.index + 1} / {project.blocks.length} · Beats {position.firstBeat}–{position.lastBeat}</small>}
      {project !== null && <small>{project.recipe.name} · frozen revision</small>}
      <div className={css.playerMetrics}>
        <div><small>Routine tempo</small><strong>{project === null ? '—' : `${project.recipe.parameters.bpm} BPM`}</strong></div>
        <div><small>Beat</small><strong>{beat === null ? '—' : `${beat % 4 + 1} / 4`}</strong></div>
        <div><small>Measured body speed</small><strong>{reference ? 'Not measured' : telemetry === undefined || telemetry.rootSpeed === null ? 'Not recorded' : `${telemetry.rootSpeed.toFixed(3)} m/s`}</strong></div>
      </div>
      {beat !== null && <div className={css.beats} aria-label={`Beat ${beat % 4 + 1} of four`}>{[0, 1, 2, 3].map(index =>
        <span key={index} className={beat % 4 === index ? css.beatActive : undefined} />)}</div>}
      {reference && <p className={css.surfaceNotice}>This illustrates the desired joint targets.
        It does not test balance or prove the robot learned the routine.</p>}
      {!reference && last?.terminated === true && <p className={css.surfaceNotice}>
        This simulation ended early at {last.time.toFixed(2)} seconds. Audio stops with the recording.</p>}
      {project !== null && !reference && playback.duration < project.clip.duration && <p className={css.surfaceNotice}>
        Recorded {playback.duration.toFixed(2)} of the target's {project.clip.duration.toFixed(2)} seconds.
        This is not a completed routine.</p>}
      {lab.recordingEvaluation !== null && <p className={css.surfaceNotice}>
        Report {lab.recordingEvaluation.evaluationId} · episode {lab.recordingEvaluation.episodeIndex + 1}.
        New simulation using saved assessment inputs, not the original evaluation recording. Recorded report metrics remain unchanged.</p>}
      <p className={css.hash}>{reference ? recording.projectSha256 : recording.policyHash}</p>
    </div>}
    <details className={css.card} open={view.inspector} onToggle={(event) => { props.actions.inspector(event.currentTarget.open) }}>
      <summary>Motion details</summary>
      {group !== null && <label>Recorded duck<select value={track?.member.id}
        onChange={(event) => { props.actions.selectDuck(Number(event.target.value)) }}>
        {group.tracks.map(item => <option key={item.member.id} value={item.member.id}>{item.member.name}</option>)}</select></label>}
      <p>{frame === undefined ? 'No motion sample loaded' : reference ? 'Kinematic target values' : 'Recorded physics values'}
        {' · '}angles in degrees; velocities in degrees/second.</p>
      {selectedBody !== undefined && view.selectedBody !== null && <p>Selected part: {lab.scene?.bodies[view.selectedBody]}<br />
        World position (meters, Z up): {selectedBody.slice(0, 3).map(value => value.toFixed(3)).join(', ')}</p>}
      <label>Joint<select value={joint} onChange={(event) => { props.actions.selectedJoint(Number(event.target.value)) }}>
        {profile?.joints.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}</select></label>
      <dl className={css.telemetry}><dt>{reference ? 'Target pose' : 'Actual angle'}</dt><dd>{degrees(telemetry?.jointPosition[joint])}</dd>
        <dt>Controller target</dt><dd>{reference ? 'Not measured' : degrees(telemetry?.controllerTarget?.[joint])}</dd>
        <dt>Joint velocity</dt><dd>{reference ? 'Not measured' : jointVelocity === undefined ? 'Not recorded' : `${(jointVelocity * 180 / Math.PI).toFixed(1)}°/s`}</dd>
        <dt>Actuator torque</dt><dd>{reference || jointTorque === undefined ? 'Not measured' : `${jointTorque.toFixed(3)} N·m`}</dd>
        <dt>Body tilt</dt><dd>{degrees(telemetry?.rootTilt)}</dd></dl>
      <p className={css.surfaceNotice}>Replay speed changes audio tempo and pitch, not the saved routine or training.
        Physical speed is measured in recorded time. Foot contacts are not recorded.</p>
    </details>
    {lab.error !== null && <p className={css.error} role="alert">{lab.error}</p>}
  </section>
}
