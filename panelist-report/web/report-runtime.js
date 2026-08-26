window.__reportInit = function(root){
  root = root || document;
  var r=document.documentElement, K='panelist-report-theme';
  try{var s=localStorage.getItem(K); if(s) r.setAttribute('data-theme',s);}catch(e){}
  var b=root.getElementById ? root.getElementById('themeBtn') : root.querySelector('#themeBtn');
  if(b) b.addEventListener('click',function(){
    var cur=r.getAttribute('data-theme');
    if(!cur) cur = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark':'light';
    var nxt = cur==='dark' ? 'light':'dark';
    r.setAttribute('data-theme',nxt);
    try{localStorage.setItem(K,nxt);}catch(e){}
  });
  var pb=root.getElementById ? root.getElementById('printBtn') : root.querySelector('#printBtn'); if(pb) pb.addEventListener('click',function(){window.print();});
  var tip=document.querySelector('body > .tip');
  if(!tip){ tip=document.createElement('div'); tip.className='tip'; document.body.appendChild(tip); }
  function show(e){
    var t=e.currentTarget.getAttribute('data-tip'); if(!t) return;
    tip.textContent=t; tip.classList.add('on');
    var x=e.clientX+14, y=e.clientY-34, w=tip.offsetWidth||140;
    if(x+w>innerWidth-8) x=e.clientX-w-14; if(y<6) y=e.clientY+20;
    tip.style.left=x+'px'; tip.style.top=y+'px';
  }
  function hide(){tip.classList.remove('on');}
  root.querySelectorAll('[data-tip]').forEach(function(el){
    if(el.__tipBound) return; el.__tipBound=true;
    el.classList.add('hit');
    el.addEventListener('mousemove',show); el.addEventListener('mouseenter',show);
    el.addEventListener('mouseleave',hide);
    el.addEventListener('touchstart',function(ev){show(ev.touches?{clientX:ev.touches[0].clientX,
      clientY:ev.touches[0].clientY,currentTarget:el}:ev);},{passive:true});
  });
};
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', function(){ window.__reportInit(document); });
else window.__reportInit(document);
