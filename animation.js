/* ===================================================================
   ANIMATION.JS — Ripple effects and small UI micro-animations
   =================================================================== */
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
