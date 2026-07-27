/* ===================================================================
   ANIMATION.JS — Ripple effects, small UI micro-animations, and
   pausing the decorative background scene while the tab is hidden.
   (prefers-reduced-motion is handled entirely in style.css — this
   file only concerns itself with tab visibility.)
   =================================================================== */
/* ===================================== */
/* PAUSE STATE DECISION (pure, testable) */
/* ===================================== */
function shouldPauseAnimations({ hidden }) {
  return !!hidden;
}
if (typeof document !== 'undefined') {
/* ===================================== */
/* RIPPLE EFFECT ON BUTTONS              */
/* ===================================== */
document.addEventListener('click', (e) => {
  const target = e.target.closest('.btn, .btn-mini, .chip, .nav-item');
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const ripple = document.createElement('span');
  const size = Math.max(rect.width, rect.height);
  ripple.style.cssText = `
    position: absolute;
    left: ${e.clientX - rect.left - size / 2}px;
    top: ${e.clientY - rect.top - size / 2}px;
    width: ${size}px; height: ${size}px;
    background: rgba(255,255,255,0.35);
    border-radius: 50%;
    pointer-events: none;
    transform: scale(0);
    animation: rippleAnim 0.6s ease-out forwards;
  `;
  const prevPos = getComputedStyle(target).position;
  if (prevPos === 'static') target.style.position = 'relative';
  target.style.overflow = 'hidden';
  target.appendChild(ripple);
  setTimeout(() => ripple.remove(), 650);
});
/* ===================================== */
/* INJECT RIPPLE KEYFRAMES ONCE          */
/* ===================================== */
(function injectRippleKeyframes() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes rippleAnim {
      to { transform: scale(2.6); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
})();
/* ===================================== */
/* PAUSE SCENE ANIMATION WHILE TAB HIDDEN */
/* ===================================== */
(function bindVisibilityPause() {
  const apply = () => {
    document.body.classList.toggle('anim-paused', shouldPauseAnimations({ hidden: document.hidden }));
  };
  document.addEventListener('visibilitychange', apply);
  apply();
})();
} // end typeof document guard
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { shouldPauseAnimations };
}
