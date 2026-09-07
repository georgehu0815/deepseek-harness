/** Exercise twelve dance/audio choices in an isolated browser against the existing authenticated GUI. */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { sampleAuthoredClip } from '../../packages/client/ui-robot-lab/src/client/clip-motion.ts';
const require=createRequire(new URL('../../apps/web/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('./',import.meta.url);
const old=JSON.parse(readFileSync(new URL('../microduck-dances/manifest.json',root),'utf8')).clips;
const fresh=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8')).clips;
const tracks=JSON.parse(readFileSync(new URL('../microduck-dance-audio/manifest.json',root),'utf8')).tracks;
const choices=[...old.map(r=>({...r,id:r.dance,folder:'../microduck-dances/'})),...fresh.map(r=>({...r,folder:'./'}))];
assert.ok(process.env.DSH_VERIFY_URL,'Supply DSH_VERIFY_URL, never store its credential in this file.');
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1920,height:1200},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.DSH_VERIFY_URL);await page.reload();
  await page.getByRole('tree',{name:'Sessions',exact:true}).getByText('Regenerate Dance Motions for Micduck Verification',{exact:true}).click();
  await page.getByText('Clip & Motion Gen',{exact:true}).click();
  const animate=page.getByRole('region',{name:'3 · Animate & verify',exact:true});
  const workspace=page.getByRole('region',{name:'Simulation workspace',exact:true});
  const picker=animate.getByRole('combobox',{name:'Load a generated dance',exact:true});
  await picker.waitFor({timeout:60000});
  assert.deepEqual(await picker.locator('option').evaluateAll(o=>o.map(v=>v.value)),['',...choices.map(r=>r.id)]);
  const timeline=animate.getByRole('slider',{name:'Animation timeline',exact:true});
  const results=[];
  for(const row of choices) {
    const clip=JSON.parse(readFileSync(new URL(row.folder+row.clipFile,root),'utf8'));
    await picker.selectOption(row.id);
    if(clip.version===1)await animate.getByRole('button',{name:'Joints',exact:true}).click();
    await workspace.locator('canvas').waitFor({state:'visible',timeout:120000});
    const audio=workspace.locator('audio');
    await page.waitForFunction(()=>{const a=document.querySelector('section[aria-label="Simulation workspace"] audio');return a?.readyState>=2;});
    assert.equal(await audio.evaluate(a=>a.paused),true);
    assert.equal(await animate.getByLabel('Clip name',{exact:true}).inputValue(),clip.name);
    const download=page.waitForEvent('download');
    await animate.getByRole('button',{name:'Save clip JSON',exact:true}).click();
    assert.deepEqual(JSON.parse(readFileSync(await(await download).path(),'utf8')),clip);
    const decoded=await audio.evaluate(async a=>{
      const bytes=Uint8Array.from(atob(a.src.split(',')[1]),c=>c.charCodeAt(0));
      const ctx=new AudioContext();
      try {
        const buffer=await ctx.decodeAudioData(bytes.buffer); const pcm=buffer.getChannelData(0);
        let energy=0,peak=0;for(const v of pcm){energy+=v*v;peak=Math.max(peak,Math.abs(v));}
        return {duration:buffer.duration,rms:Math.sqrt(energy/pcm.length),peak};
      }finally{await ctx.close();}
    });
    assert.ok(decoded.rms>.01 && decoded.peak<1);
    assert.ok(Math.abs(decoded.duration-clip.duration)<.05);
    await audio.evaluate(a=>{
      a.probe={plays:0,pauses:0,seeks:0};
      const play=a.play.bind(a),pause=a.pause.bind(a);
      a.play=()=>{a.probe.plays++;return play();};a.pause=()=>{a.probe.pauses++;pause();};
      a.addEventListener('seeking',()=>a.probe.seeks++);
    });
    await animate.getByRole('button',{name:'Play sequence',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('section[aria-label="Simulation workspace"] audio').currentTime>.35);
    const clockSamples=await page.evaluate(()=>new Promise(resolve=>{
      const samples=[];
      const sample=now=>{
        samples.push({now,audio:document.querySelector('section[aria-label="Simulation workspace"] audio').currentTime,
          timeline:Number(document.querySelector('section[aria-label="3 · Animate & verify"] input[aria-label="Animation timeline"]').value)});
        if(samples.length<12)requestAnimationFrame(sample);else resolve(samples);
      };requestAnimationFrame(sample);
    }));
    const timing=clockSamples.at(-1);
    const maxFrameSeconds=Math.max(...clockSamples.slice(1).map((s,i)=>(s.now-clockSamples[i].now)/1000));
    const maxClockDifference=Math.max(...clockSamples.slice(2).map(s=>Math.abs(s.audio-s.timeline)));
    const playbackCalls=await audio.evaluate(a=>a.probe);
    console.log(JSON.stringify({id:row.id,clockSamples,maxFrameSeconds,maxClockDifference,playbackCalls}));
    assert.equal(playbackCalls.plays,1,'Media must not restart on pose ticks');
    assert.ok(maxClockDifference<maxFrameSeconds+.05,'Audio/motion diverged beyond one measured render interval');
    assert.equal(await audio.evaluate(a=>a.paused),false);
    await animate.getByRole('button',{name:'Pause sequence',exact:true}).click();
    assert.equal(await audio.evaluate(a=>a.paused),true);
    await timeline.fill('12');
    assert.ok(Math.abs(await audio.evaluate(a=>a.currentTime)-12)<.02);
    await workspace.getByRole('combobox',{name:'Playback speed',exact:true}).selectOption('0.5');
    await animate.getByRole('button',{name:'Play sequence',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('section[aria-label="Simulation workspace"] audio').currentTime>12.2);
    assert.equal(await audio.evaluate(a=>a.playbackRate),.5);
    const mute=animate.getByRole('checkbox',{name:'Mute dance audio',exact:true});
    await mute.check();assert.equal(await audio.evaluate(a=>a.muted),true);
    await mute.uncheck();assert.equal(await audio.evaluate(a=>a.muted),false);
    await animate.getByRole('slider',{name:'Dance audio volume',exact:true}).fill('0.25');
    assert.equal(await audio.evaluate(a=>a.volume),.25);
    await animate.getByRole('button',{name:'Pause sequence',exact:true}).click();
    await workspace.getByRole('combobox',{name:'Playback speed',exact:true}).selectOption('1');
    if(row.id.endsWith('_v2')) {
      const review=animate.getByRole('checkbox',{name:'I reviewed this revision in the preview',exact:true});
      assert.equal(await review.isChecked(),false);
      const intro=clip.contacts[0].end, stepTime=(clip.duration-2*intro)/row.stepCount;
      const t=Number((intro+stepTime/2).toFixed(2));
      await timeline.fill(String(t));
      assert.equal(await animate.getByRole('button',{name:'Joints',exact:true}).getAttribute('aria-pressed'),'true');
      const expected=sampleAuthoredClip(clip,t);
      const profile=JSON.parse(readFileSync(new URL('model.json',root),'utf8')).profile;
      for(const [i,joint] of profile.joints.entries()) {
        const slider=animate.getByRole('slider',{name:joint.name,exact:true});
        assert.ok((await slider.getAttribute('aria-valuetext')).startsWith(expected.joints[i].toFixed(3)+' rad'));
        assert.equal(await slider.isDisabled(),true);
      }
      await animate.getByRole('heading',{name:'3 · Animate & verify',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:new URL(row.id+'-step-audio.png',root).pathname});
      const headingKey=clip.keys.reduce((a,b)=>a.rootYaw>b.rootYaw?a:b);
      await timeline.fill(String(Number(headingKey.t.toFixed(2))));
      await animate.getByRole('heading',{name:'3 · Animate & verify',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:new URL(row.id+'-turn-audio.png',root).pathname});
      await review.check();
      await animate.getByLabel('Clip name',{exact:true}).fill(clip.name+' edited');
      assert.equal(await review.isChecked(),false);
      await picker.selectOption(row.id);
      assert.equal(await animate.getByLabel('Clip name',{exact:true}).inputValue(),clip.name);
      assert.equal(await audio.evaluate(a=>a.paused),true);
    }
    assert.deepEqual(await animate.getByRole('alert').allTextContents(),[]);
    const result={id:row.id,clipSha256:row.clipSha256,audioSha256:tracks.find(t=>t.id===row.id).sha256,
      duration:clip.duration,exactJsonExport:true,decodedAudio:decoded,maxObservedClockDifferenceSeconds:maxClockDifference,
      maxObservedRenderIntervalSeconds:maxFrameSeconds,lastClockSample:timing,
      sharedPlayPauseSeek:true,halfSpeed:true,muteAndVolume:true,noAutoplay:true};
    results.push(result);console.log(JSON.stringify(result));
  }
  assert.deepEqual(errors,[]);
  writeFileSync(new URL('browser-verification.json',root),JSON.stringify({url:'http://127.0.0.1:3082/',isolatedBrowser:true,
    audioEvidence:'Browser codec decoded nonzero PCM and media playback advanced with the shared motion clock; not a physical speaker audition.',
    pageErrors:errors,results},null,2)+'\n');
}catch(error){
  const page=browser.contexts()[0]?.pages()[0];if(page)await page.screenshot({path:new URL('browser-failure.png',root).pathname});
  throw error;
}finally{await browser.close();}
