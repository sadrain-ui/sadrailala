/* Legion mobile optimizer — authorized QA clones */
(function(){
  var MOBILE=/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i;
  var root=document.documentElement;
  root.classList.add('legion-mobile-opt');
  function apply(){
    var mobile=MOBILE.test(navigator.userAgent||'')||window.innerWidth<768;
    root.classList.toggle('legion-is-mobile',mobile);
    root.classList.toggle('legion-is-desktop',!mobile);
    var vp=document.querySelector('meta[name="viewport"]');
    if(mobile&&!vp){
      var m=document.createElement('meta');
      m.name='viewport';
      m.content='width=device-width,initial-scale=1,viewport-fit=cover';
      document.head.appendChild(m);
    }
  }
  apply();
  window.addEventListener('resize',apply,{passive:true});
  window.addEventListener('orientationchange',apply,{passive:true});
})();