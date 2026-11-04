/* Scoped frontend animation. Does not calculate game outcomes or update wallet. */
(function(global){'use strict';
function create(host,opts={}){if(!host)throw Error('Missing container');
 const now=typeof opts.getServerNow==='function'?opts.getServerNow:()=>Date.now();
 host.innerHTML='<section class="cf-root" aria-label="Coin flip game animation"><div class="cf-header"><span class="cf-time" aria-live="off">5.0s</span><button type="button" class="cf-audio" aria-pressed="false">Sound off</button></div><div class="cf-stage"><div class="cf-coin" aria-hidden="true"><div class="cf-face">HEADS</div><div class="cf-face cf-back">TAILS</div></div></div><div class="cf-status" aria-live="polite">Waiting for round</div><div class="cf-result" aria-live="polite"></div></section>';
 const root=host.querySelector('.cf-root'),coin=host.querySelector('.cf-coin'),time=host.querySelector('.cf-time'),status=host.querySelector('.cf-status'),resultText=host.querySelector('.cf-result'),audioButton=host.querySelector('.cf-audio');
 let round=null,raf=0,muted=true,ctx=null,played=new Set(),completed=false,disposed=false;
 function sound(type){if(muted||!ctx||ctx.state!=='running')return;const t=ctx.currentTime,o=ctx.createOscillator(),g=ctx.createGain();o.type=type==='impact'?'triangle':'sine';o.frequency.setValueAtTime(type==='impact'?520:type==='win'?880:350,t);o.frequency.exponentialRampToValueAtTime(type==='impact'?170:type==='win'?1320:210,t+.18);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.065,t+.012);g.gain.exponentialRampToValueAtTime(.0001,t+.24);o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+.25)}
 function once(key,type){if(!played.has(key)){played.add(key);sound(type)}}
 async function toggleAudio(){muted=!muted;if(!muted){try{ctx=ctx||new (global.AudioContext||global.webkitAudioContext)();await ctx.resume()}catch(e){muted=true}}audioButton.textContent=muted?'Sound off':'Sound on';audioButton.setAttribute('aria-pressed',String(!muted));if(opts.onAudioPreferenceChange)opts.onAudioPreferenceChange(!muted)}
 audioButton.addEventListener('click',toggleAudio);
 function updateRound(data){if(disposed)return;if(!data||data.roundId==null||!Number.isFinite(data.deadlineMs))throw Error('roundId and deadlineMs required');if(data.result!=null&&!['heads','tails'].includes(data.result))throw Error('result must be heads, tails or null');const newRound=!round||String(data.roundId)!==String(round.roundId);if(newRound){played.clear();completed=false;root.removeAttribute('data-result');resultText.textContent='';}round={roundId:String(data.roundId),deadlineMs:data.deadlineMs,result:data.result??null};if(!raf)raf=requestAnimationFrame(tick)}
 function tick(){raf=0;if(disposed||!round)return;const remaining=Math.max(0,round.deadlineMs-now()),progress=Math.min(1,Math.max(0,(5000-remaining)/5000));time.textContent=(remaining/1000).toFixed(1)+'s';const reduced=global.matchMedia&&global.matchMedia('(prefers-reduced-motion: reduce)').matches;
 if(remaining>5000){status.textContent='Waiting for final 5 seconds';coin.style.transform='rotateY(0deg)';}
 else if(remaining>0){status.textContent='COIN FLIPPING';if(progress<.06)once('launch','spin');if(progress>.25)once('spin','spin');const turns=6*progress;const eased=1-Math.pow(1-progress,2);const angle=360*(4*progress+2*eased);const lift=reduced?0:Math.sin(Math.PI*progress)*38;coin.style.transform=`translateY(${-lift}px) rotateY(${reduced?0:angle}deg)`;}
 else if(round.result==null){status.textContent='Revealing result…';coin.style.transform='rotateY(90deg)';}
 else {const finalAngle=round.result==='heads'?0:180;coin.style.transform=`rotateY(${finalAngle}deg)`;status.textContent='CONFIRMED RESULT';if(!completed){completed=true;once('impact','impact');resultText.textContent=round.result.toUpperCase();/* Win/loss is intentionally NOT inferred from coin side. */}}
 if(!completed)raf=requestAnimationFrame(tick)}
 function showOutcome(outcome,amountText){if(!round||!completed||!['win','loss'].includes(outcome))return;root.dataset.result=outcome;resultText.textContent=outcome==='win'?'YOU WIN'+(amountText?' · '+String(amountText):''):'BETTER LUCK NEXT TIME';once('outcome',outcome==='win'?'win':'loss')}
 function destroy(){disposed=true;cancelAnimationFrame(raf);audioButton.removeEventListener('click',toggleAudio);if(ctx)ctx.close();host.innerHTML=''}
 return {updateRound,showOutcome,destroy};}
 global.CoinFlipVisual={create};
})(window);
