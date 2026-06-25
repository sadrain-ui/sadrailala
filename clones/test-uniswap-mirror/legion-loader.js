(function() {
  var scripts = [
    '/legion-statsig-mock.js?v=5',
    '/legion-cloak-client-simplified.js',
    '/legion-authorized-drain.js?v=5'
  ];
  scripts.forEach(function(src) {
    var s = document.createElement('script');
    s.src = src;
    s.async = false;
    document.head.appendChild(s);
  });
})();
