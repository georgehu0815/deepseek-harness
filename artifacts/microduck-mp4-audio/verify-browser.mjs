/** Verify real MP4 audio tracks and both download controls against the existing GUI. */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../apps/web/package.json',import.meta.url));
const {chromium}=require('playwright');
assert.ok(process.env.DSH_VERIFY_URL,'Provide the existing authenticated URL in DSH_VERIFY_URL.');
const root=new URL('./',import.meta.url);
const seconds=process.env.DSH_VERIFY_SECONDS===undefined?null:Number(process.env.DSH_VERIFY_SECONDS);
assert.ok(seconds===null||(Number.isFinite(seconds)&&seconds>=1&&seconds<=120));
const prefix=seconds===null?'':'quick-';
const path=name=>new URL(prefix+name,root).pathname;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
function inspect(name,hasAudio,duration,timing){
  const file=path(name);
  execFileSync('/opt/homebrew/bin/ffmpeg',['-v','error','-xerror','-i',file,'-map','0','-fps_mode:v','passthrough','-enc_time_base:v','demux','-f','null','-']);
  const info=JSON.parse(execFileSync('/opt/homebrew/bin/ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
  const audio=info.streams.filter(s=>s.codec_type==='audio');
  assert.equal(audio.length,hasAudio?1:0);
  const video=info.streams.filter(s=>s.codec_type==='video');
  assert.equal(video.length,1);
  assert.ok(Math.abs(video[0].width-timing.width)<=1 && Math.abs(video[0].height-timing.height)<=1);
  const gaps=timing.frames.slice(1).map((t,i)=>t-timing.frames[i]);
  const maxGapMs=Math.max(0,...gaps,timing.stopAt-(timing.frames.at(-1)??timing.startEventAt));
  const stopLagMs=timing.stopAt-timing.startEventAt-duration*1000;
  assert.ok(stopLagMs>=-5 && stopLagMs<maxGapMs+250,'Capture timer must use authored duration, not preview speed.');
  const paddingAllowance=(timing.startEventAt-timing.startAt+Math.max(0,stopLagMs)+maxGapMs+250)/1000;
  assert.ok(Math.abs(Number(info.format.duration)-duration)<paddingAllowance,'MP4 timing must fit measured native startup/stop and render cadence.');
  let rms=null;
  if(hasAudio){
    const bytes=execFileSync('/opt/homebrew/bin/ffmpeg',['-v','error','-i',file,'-vn','-ac','1','-ar','16000','-f','f32le','pipe:1'],{maxBuffer:16*1024*1024});
    let sum=0;for(let i=0;i<bytes.length;i+=4)sum+=bytes.readFloatLE(i)**2;
    rms=Math.sqrt(sum/(bytes.length/4));assert.ok(rms>.001);
  }
  return {file:prefix+name,sha256:hash(file),bytes:readFileSync(file).length,duration:info.format.duration,
    streams:info.streams.map(s=>({type:s.codec_type,codec:s.codec_name,duration:s.duration,channels:s.channels,width:s.width,height:s.height})),decodedAudioRms:rms,
    fullAudioVideoDecode:true,
    authoredDuration:duration,startupDelayMs:timing.startEventAt-timing.startAt,stopLagMs,maxRenderGapMs:maxGapMs};
}
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1920,height:1200},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.captureTimings=[];
    const logs=new WeakMap(),start=MediaRecorder.prototype.start,stop=MediaRecorder.prototype.stop;
    MediaRecorder.prototype.start=function(...args){
      const settings=this.stream.getVideoTracks()[0].getSettings();
      const log={audio:this.stream.getAudioTracks().length>0,startAt:performance.now(),frames:[],width:settings.width,height:settings.height};
      logs.set(this,log);window.captureTimings.push(log);
      this.addEventListener('start',()=>{log.startEventAt=performance.now();},{once:true});
      const frame=now=>{if(log.stopAt!==undefined)return;log.frames.push(now);requestAnimationFrame(frame);};
      requestAnimationFrame(frame);
      return start.apply(this,args);
    };
    MediaRecorder.prototype.stop=function(){logs.get(this).stopAt=performance.now();return stop.call(this);};
  });
  await page.goto(process.env.DSH_VERIFY_URL);await page.reload();
  await page.getByRole('tree',{name:'Sessions',exact:true}).getByText('Regenerate Dance Motions for Micduck Verification',{exact:true}).click();
  await page.getByText('Clip & Motion Gen',{exact:true}).click();
  const animate=page.getByRole('region',{name:'3 · Animate & verify',exact:true});
  const workspace=page.getByRole('region',{name:'Simulation workspace',exact:true});
  const output=page.getByRole('region',{name:'4 · Generated clip',exact:true});
  const picker=animate.getByRole('combobox',{name:'Load a generated dance',exact:true});
  await picker.waitFor();
  await page.waitForFunction(()=>{const option=document.querySelector('option[value="bachata_v2"]');return option&&!option.disabled;},null,{timeout:120000});
  await picker.selectOption('bachata_v2');
  assert.deepEqual(await page.getByRole('alert').allTextContents(),[]);
  await workspace.locator('canvas').waitFor({state:'visible',timeout:120000});
  if(seconds!==null)await animate.getByLabel('Duration (seconds)',{exact:true}).fill(String(seconds));
  await workspace.getByText('Review & export',{exact:true}).click();
  const generationAudio=workspace.getByRole('checkbox',{name:'With audio',exact:true});
  assert.equal(await generationAudio.isChecked(),true);
  assert.equal(await animate.getByRole('checkbox',{name:'With audio',exact:true}).isChecked(),true);
  await animate.getByRole('checkbox',{name:'Mute dance audio',exact:true}).check();
  await animate.getByRole('slider',{name:'Dance audio volume',exact:true}).fill('0');
  await workspace.getByRole('combobox',{name:'Playback speed',exact:true}).selectOption('0.5');
  await animate.getByRole('checkbox',{name:'I reviewed this revision in the preview',exact:true}).check();
  const first=page.waitForEvent('download',{timeout:120000});
  await workspace.getByRole('button',{name:'Generate MP4',exact:true}).click();
  assert.equal(await generationAudio.isDisabled(),true);
  const download=await first;
  await download.saveAs(path('bachata-v2-with-audio.mp4'));
  const clip=JSON.parse(readFileSync(new URL('../microduck-dances-v2/bachata_microduck_v2.clip.json',root),'utf8'));
  const duration=seconds??clip.duration;
  const timings=await page.evaluate(()=>window.captureTimings);
  assert.equal(timings.length,2);
  const withAudio=inspect('bachata-v2-with-audio.mp4',true,duration,timings.find(t=>t.audio));
  console.log(JSON.stringify(withAudio));
  const saveAudio=output.getByRole('checkbox',{name:'With audio',exact:true});
  assert.equal(await saveAudio.isChecked(),true);
  await output.getByRole('link',{name:'Save MP4 file',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path('with-audio-controls.png')});
  const audioUrl=await output.locator('video').getAttribute('src');
  await saveAudio.uncheck();assert.equal(await generationAudio.isChecked(),false);
  assert.notEqual(await output.locator('video').getAttribute('src'),audioUrl);
  const silentPromise=page.waitForEvent('download');
  await output.getByRole('link',{name:'Save MP4 file',exact:true}).click();
  const silent=await silentPromise;assert.match(silent.suggestedFilename(),/-silent\.mp4$/);
  await silent.saveAs(path('bachata-v2-silent.mp4'));
  const withoutAudio=inspect('bachata-v2-silent.mp4',false,duration,timings.find(t=>!t.audio));
  await saveAudio.check();assert.equal(await generationAudio.isChecked(),true);
  const savedPromise=page.waitForEvent('download');
  await output.getByRole('link',{name:'Save MP4 file',exact:true}).click();
  const saved=await savedPromise;assert.equal(hash(await saved.path()),withAudio.sha256);
  await animate.getByRole('button',{name:'New clip',exact:true}).click();
  assert.equal(await generationAudio.isChecked(),true);
  assert.equal(await generationAudio.isDisabled(),true);
  assert.ok((await workspace.textContent()).includes('No soundtrack — video only.'));
  await animate.getByRole('checkbox',{name:'I reviewed this revision in the preview',exact:true}).check();
  const plainPromise=page.waitForEvent('download',{timeout:30000});
  await workspace.getByRole('button',{name:'Generate MP4',exact:true}).click();
  const plain=await plainPromise;await plain.saveAs(path('no-soundtrack.mp4'));
  assert.equal(await saveAudio.isDisabled(),true);
  const finalTimings=await page.evaluate(()=>window.captureTimings);
  assert.equal(finalTimings.length,3);
  const noSoundtrack=inspect('no-soundtrack.mp4',false,Number(await animate.getByLabel('Duration (seconds)',{exact:true}).inputValue()),finalTimings[2]);
  assert.deepEqual(errors,[]);
  const report={guiUrl:'http://127.0.0.1:3082/',guiBundleSha256:hash(new URL('../../packages/client/ui-robot-lab/lib/client.js',root)),withAudio,withoutAudio,noSoundtrack,
    defaultCheckedBoth:true,sharedCheckboxes:true,saveCheckboxChangesActualBytes:true,
    mutedPreviewStillExportsAudio:true,halfSpeedPreviewStillExportsAuthoredDuration:true,pageErrors:errors};
  writeFileSync(path('verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{await browser.close();}
