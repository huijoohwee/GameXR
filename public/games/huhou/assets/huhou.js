const particlesRoot = document.getElementById('particles')
const particleCount = 28

for (let index = 0; index < particleCount; index += 1) {
  const particle = document.createElement('div')
  const size = 3 + Math.random() * 10
  particle.className = 'particle'
  particle.style.width = `${size}px`
  particle.style.height = `${size}px`
  particle.style.left = `${Math.random() * 100}%`
  particle.style.animationDuration = `${10 + Math.random() * 16}s`
  particle.style.animationDelay = `${Math.random() * 18}s`
  particlesRoot?.appendChild(particle)
}

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue
    entry.target.classList.add('in')
    observer.unobserve(entry.target)
  }
}, { threshold: 0.12 })

document.querySelectorAll('.reveal').forEach((element) => observer.observe(element))
