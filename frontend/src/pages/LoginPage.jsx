import React, { useState, useEffect, useRef, useCallback } from 'react'
import { API_BASE_URL } from '../config'

/**
 * LoginPage - 珠宝ERP登录页
 * 特色：两只眼睛跟随鼠标转动的有趣动画
 */
export default function LoginPage({ onLoginSuccess }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // 眼睛动画 refs
  const leftPupilRef = useRef(null)
  const rightPupilRef = useRef(null)
  const leftEyeRef = useRef(null)
  const rightEyeRef = useRef(null)

  // 眼睛跟随鼠标
  const handleMouseMove = useCallback((e) => {
    const eyes = [
      { eye: leftEyeRef.current, pupil: leftPupilRef.current },
      { eye: rightEyeRef.current, pupil: rightPupilRef.current },
    ]

    eyes.forEach(({ eye, pupil }) => {
      if (!eye || !pupil) return
      const rect = eye.getBoundingClientRect()
      const eyeCenterX = rect.left + rect.width / 2
      const eyeCenterY = rect.top + rect.height / 2

      const angle = Math.atan2(e.clientY - eyeCenterY, e.clientX - eyeCenterX)
      const maxMove = rect.width * 0.2 // 瞳孔最大移动距离
      const distance = Math.min(
        Math.hypot(e.clientX - eyeCenterX, e.clientY - eyeCenterY) * 0.08,
        maxMove
      )

      const x = Math.cos(angle) * distance
      const y = Math.sin(angle) * distance
      pupil.style.transform = `translate(${x}px, ${y}px)`
    })
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [handleMouseMove])

  // 当输入密码时眼睛"闭上"（捂眼效果）
  const [eyesClosed, setEyesClosed] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) {
      setError('请输入账号和密码')
      return
    }

    setLoading(true)
    setError('')

    try {
      const formData = new URLSearchParams()
      formData.append('username', username.trim())
      formData.append('password', password.trim())

      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      })

      const data = await response.json()

      if (response.ok) {
        onLoginSuccess({
          token: data.access_token,
          username: data.username,
          role: data.role,
          role_name: data.role_name,
        })
      } else {
        setError(data.detail || '登录失败')
      }
    } catch (err) {
      setError('网络错误，请检查服务是否运行')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.container}>
      {/* 背景装饰 */}
      <div style={styles.bgDecor1} />
      <div style={styles.bgDecor2} />

      <div style={styles.card}>
        {/* 眼睛区域 */}
        <div style={styles.eyeSection}>
          <div style={styles.face}>
            {/* 左眼 */}
            <div ref={leftEyeRef} style={styles.eye}>
              <div style={styles.eyeInner}>
                <div
                  ref={leftPupilRef}
                  style={{
                    ...styles.pupil,
                    ...(eyesClosed ? styles.pupilHidden : {}),
                  }}
                >
                  <div style={styles.pupilHighlight} />
                </div>
              </div>
              {/* 眨眼/闭眼效果 */}
              {eyesClosed && <div style={styles.eyelid} />}
            </div>

            {/* 右眼 */}
            <div ref={rightEyeRef} style={styles.eye}>
              <div style={styles.eyeInner}>
                <div
                  ref={rightPupilRef}
                  style={{
                    ...styles.pupil,
                    ...(eyesClosed ? styles.pupilHidden : {}),
                  }}
                >
                  <div style={styles.pupilHighlight} />
                </div>
              </div>
              {eyesClosed && <div style={styles.eyelid} />}
            </div>
          </div>

          {/* 嘴巴 */}
          <div style={styles.mouth}>
            <div style={error ? styles.mouthSad : styles.mouthHappy} />
          </div>
        </div>

        {/* 标题 */}
        <h1 style={styles.title}>珠宝 AI-ERP</h1>
        <p style={styles.subtitle}>智能珠宝企业资源管理系统</p>

        {/* 登录表单 */}
        <form onSubmit={handleLogin} style={styles.form}>
          {error && <div style={styles.errorBox}>{error}</div>}

          <div style={styles.inputGroup}>
            <label style={styles.label}>账号</label>
            <div style={styles.inputWrapper}>
              <svg style={styles.inputIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setEyesClosed(false)}
                placeholder="请输入账号"
                style={styles.input}
                autoComplete="username"
              />
            </div>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>密码</label>
            <div style={styles.inputWrapper}>
              <svg style={styles.inputIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setEyesClosed(true)}
                onBlur={() => setEyesClosed(false)}
                placeholder="请输入密码"
                style={styles.input}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={styles.eyeToggle}
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              ...styles.loginBtn,
              ...(loading ? styles.loginBtnDisabled : {}),
            }}
          >
            {loading ? (
              <span style={styles.loadingDots}>
                <span style={styles.dot}>●</span>
                <span style={{ ...styles.dot, animationDelay: '0.2s' }}>●</span>
                <span style={{ ...styles.dot, animationDelay: '0.4s' }}>●</span>
              </span>
            ) : (
              '登 录'
            )}
          </button>
        </form>

        <p style={styles.hint}>
          默认账号为角色拼音，密码：123456
        </p>
      </div>

      {/* CSS 动画 */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes gradient-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes blob-move-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -30px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
        }
        @keyframes blob-move-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-30px, 20px) scale(0.9); }
          66% { transform: translate(20px, -30px) scale(1.1); }
        }
      `}</style>
    </div>
  )
}


// ========== 样式 ==========

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    backgroundSize: '200% 200%',
    animation: 'gradient-shift 6s ease infinite',
    position: 'relative',
    overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  bgDecor1: {
    position: 'absolute',
    top: '-10%',
    left: '-10%',
    width: '40vw',
    height: '40vw',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.08)',
    animation: 'blob-move-1 8s ease-in-out infinite',
    pointerEvents: 'none',
  },
  bgDecor2: {
    position: 'absolute',
    bottom: '-15%',
    right: '-10%',
    width: '35vw',
    height: '35vw',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.05)',
    animation: 'blob-move-2 10s ease-in-out infinite',
    pointerEvents: 'none',
  },
  card: {
    background: 'rgba(255, 255, 255, 0.95)',
    backdropFilter: 'blur(20px)',
    borderRadius: '24px',
    padding: '40px 36px 32px',
    width: '100%',
    maxWidth: '400px',
    margin: '0 16px',
    boxShadow: '0 25px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(255,255,255,0.2)',
    position: 'relative',
    zIndex: 1,
    animation: 'float 4s ease-in-out infinite',
  },
  eyeSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: '16px',
  },
  face: {
    display: 'flex',
    gap: '20px',
    justifyContent: 'center',
    alignItems: 'center',
  },
  eye: {
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    background: '#fff',
    border: '3px solid #e0e0e0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.08)',
  },
  eyeInner: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pupil: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: 'radial-gradient(circle at 35% 35%, #555, #1a1a1a)',
    transition: 'transform 0.08s ease-out',
    position: 'relative',
  },
  pupilHidden: {
    opacity: 0,
    transition: 'opacity 0.2s ease',
  },
  pupilHighlight: {
    position: 'absolute',
    top: '4px',
    left: '6px',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.8)',
  },
  eyelid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: '45%',
    background: 'linear-gradient(to bottom, #f5e6d3, #e8d5c0)',
    borderRadius: '50% 50% 0 0',
    transition: 'all 0.3s ease',
    zIndex: 2,
  },
  mouth: {
    marginTop: '8px',
    width: '30px',
    height: '15px',
    display: 'flex',
    justifyContent: 'center',
  },
  mouthHappy: {
    width: '24px',
    height: '12px',
    borderBottom: '3px solid #999',
    borderRadius: '0 0 12px 12px',
  },
  mouthSad: {
    width: '24px',
    height: '12px',
    borderTop: '3px solid #e74c3c',
    borderRadius: '12px 12px 0 0',
    marginTop: '4px',
  },
  title: {
    textAlign: 'center',
    fontSize: '24px',
    fontWeight: 700,
    color: '#1a1a2e',
    margin: '8px 0 4px',
    letterSpacing: '1px',
  },
  subtitle: {
    textAlign: 'center',
    fontSize: '13px',
    color: '#888',
    margin: '0 0 24px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  errorBox: {
    background: '#fff2f0',
    border: '1px solid #ffccc7',
    borderRadius: '8px',
    padding: '10px 14px',
    fontSize: '13px',
    color: '#cf1322',
    textAlign: 'center',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#555',
    paddingLeft: '2px',
  },
  inputWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: '12px',
    width: '18px',
    height: '18px',
    color: '#aaa',
    pointerEvents: 'none',
  },
  input: {
    width: '100%',
    padding: '12px 40px 12px 38px',
    fontSize: '15px',
    border: '2px solid #e8e8e8',
    borderRadius: '12px',
    outline: 'none',
    transition: 'all 0.2s ease',
    background: '#fafafa',
    color: '#333',
    boxSizing: 'border-box',
  },
  eyeToggle: {
    position: 'absolute',
    right: '10px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    color: '#aaa',
    display: 'flex',
    alignItems: 'center',
  },
  loginBtn: {
    width: '100%',
    padding: '14px',
    fontSize: '16px',
    fontWeight: 600,
    color: '#fff',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    letterSpacing: '2px',
    marginTop: '4px',
  },
  loginBtnDisabled: {
    opacity: 0.7,
    cursor: 'not-allowed',
  },
  loadingDots: {
    display: 'flex',
    gap: '4px',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    fontSize: '8px',
    animation: 'pulse-dot 0.8s ease infinite',
  },
  hint: {
    textAlign: 'center',
    fontSize: '12px',
    color: '#bbb',
    marginTop: '16px',
    marginBottom: 0,
  },
}
