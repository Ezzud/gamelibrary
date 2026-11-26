import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import enUs from './en-us'
import frFr from './fr-fr'
import { getAppConfig, setLanguage as saveLanguage } from '../services/ConfigManager'

type LanguageContextValue = {
  language: string
  selectedLanguage: string
  appliedLanguagePreference: string
  setLanguage: (language: string) => Promise<void>
  t: (langlinepath: string) => string
}

export const AVAILABLE_LANGUAGES = [
  { code: 'en-us', labelKey: 'language.english', countryCode: 'US' },
  { code: 'fr-fr', labelKey: 'language.french', countryCode: 'FR' },
] as const

const LanguageContext = createContext<LanguageContextValue | null>(null)
const englishFallback: Record<string, string> = enUs
const supportedLanguages: Record<string, Record<string, string>> = { 'en-us': englishFallback, 'fr-fr': frFr }

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

let activeLanguage = 'en-us'

export function translateText(text: string, language = activeLanguage) {
  const selected = supportedLanguages[language.toLowerCase()]
    || supportedLanguages[language.toLowerCase().split('-')[0]]
  if (!selected) return text
  const directEntry = Object.entries(englishFallback).find(([, value]) => value === text)
  if (directEntry) return selected[directEntry[0]] ?? directEntry[1]

  for (const [key, template] of Object.entries(englishFallback)) {
    if (!template.includes('{')) continue
    const names: string[] = []
    const pattern = new RegExp(`^${template.split(/({[^}]+})/g).map((part) => {
      if (part.startsWith('{') && part.endsWith('}')) {
        names.push(part.slice(1, -1))
        return '(.+?)'
      }
      return escapeRegExp(part)
    }).join('')}$`)
    const matches = text.match(pattern)
    if (!matches) continue
    let translated = selected[key] ?? template
    names.forEach((name, index) => { translated = translated.replace(`{${name}}`, matches[index + 1]) })
    return translated
  }
  return text
}

function systemLanguage() {
  if (typeof navigator === 'undefined') return 'en-us'
  return (navigator.languages?.[0] || navigator.language || 'en-US').toLowerCase()
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [selectedLanguage, setSelectedLanguage] = useState('')
  const [appliedLanguagePreference, setAppliedLanguagePreference] = useState('')
  const [language, setResolvedLanguage] = useState(systemLanguage())

  useEffect(() => {
    let active = true
    void getAppConfig().then((config) => {
      if (!active) return
      const selected = config.language || ''
      setSelectedLanguage(selected)
      setAppliedLanguagePreference(selected)
      setResolvedLanguage(selected || systemLanguage())
      activeLanguage = selected || systemLanguage()
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  const setLanguage = useCallback(async (value: string) => {
    await saveLanguage(value)
    setSelectedLanguage(value)
  }, [])

  const t = useCallback((langlinepath: string) => {
    const selected = supportedLanguages[language.toLowerCase()]
      || supportedLanguages[language.toLowerCase().split('-')[0]]
    return selected?.[langlinepath] ?? englishFallback[langlinepath] ?? translateText(langlinepath, language)
  }, [language])

  const value = useMemo(() => ({ language, selectedLanguage, appliedLanguagePreference, setLanguage, t }), [language, selectedLanguage, appliedLanguagePreference, setLanguage, t])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider')
  return context
}
