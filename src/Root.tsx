import { lazy, Suspense } from 'react'
const Studio = lazy(() => import('./alpha/App2'))
const Legacy = lazy(() => import('./App'))
export default function Root() {
  return <Suspense fallback={<p>악보 편집기 준비 중…</p>}>{location.pathname.includes('/legacy') ? <Legacy/> : <Studio/>}</Suspense>
}
