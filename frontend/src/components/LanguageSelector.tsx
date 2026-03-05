import React from 'react'
import { useTranslation } from 'react-i18next'

interface LanguageSelectorProps {
  onSelect: (language: string) => void
}

const LanguageSelector: React.FC<LanguageSelectorProps> = ({ onSelect }) => {
  const { i18n } = useTranslation()

  const handleSelect = (lang: string) => {
    i18n.changeLanguage(lang)
    localStorage.setItem('i18nextLng', lang)
    localStorage.setItem('languageSelected', 'true')
    onSelect(lang)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-jewelry-navy to-jewelry-navy-dark">
      {/* 背景装饰 */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-jewelry-gold/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-jewelry-gold/5 rounded-full blur-3xl"></div>
      </div>

      {/* 主内容 */}
      <div className="relative z-10 text-center">
        {/* Logo / 标题 */}
        <div className="mb-12">
          <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-jewelry-gold to-jewelry-gold-light rounded-2xl flex items-center justify-center shadow-2xl">
            <span className="text-4xl">💎</span>
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">Jewelry ERP</h1>
          <p className="text-jewelry-gold/80 text-lg">珠宝ERP智能管理系统</p>
        </div>

        {/* 语言选择标题 */}
        <h2 className="text-xl text-white/90 mb-8">选择语言 / Select Language</h2>

        {/* 语言按钮 */}
        <div className="flex gap-6 justify-center">
          {/* 中文按钮 */}
          <button
            onClick={() => handleSelect('zh')}
            className="group relative w-48 h-32 bg-white/10 backdrop-blur-sm border-2 border-white/20 rounded-2xl 
                       hover:bg-white/20 hover:border-jewelry-gold/50 transition-all duration-300
                       flex flex-col items-center justify-center gap-3"
          >
            <span className="text-4xl">🇨🇳</span>
            <span className="text-xl font-semibold text-white group-hover:text-jewelry-gold-light transition-colors">
              中文
            </span>
            <span className="text-sm text-white/60">简体中文</span>
          </button>

          {/* English 按钮 */}
          <button
            onClick={() => handleSelect('en')}
            className="group relative w-48 h-32 bg-white/10 backdrop-blur-sm border-2 border-white/20 rounded-2xl 
                       hover:bg-white/20 hover:border-jewelry-gold/50 transition-all duration-300
                       flex flex-col items-center justify-center gap-3"
          >
            <span className="text-4xl">🇺🇸</span>
            <span className="text-xl font-semibold text-white group-hover:text-jewelry-gold-light transition-colors">
              English
            </span>
            <span className="text-sm text-white/60">United States</span>
          </button>
        </div>

        {/* 底部提示 */}
        <p className="mt-12 text-white/40 text-sm">
          您可以随时在系统顶部切换语言 / You can switch language anytime in the header
        </p>
      </div>
    </div>
  )
}

export default LanguageSelector
