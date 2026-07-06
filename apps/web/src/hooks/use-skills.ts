import { useEffect, useState } from 'react'
import type { AgentProvider, SkillView } from '@runcell-science/contracts'
import { api } from '../lib/api'

export function useSkills(input: { provider: AgentProvider; cwd: string | null; sessionId: string | null }) {
  const [skills, setSkills] = useState<SkillView[]>([])

  useEffect(() => {
    let cancelled = false
    api
      .listSkills({
        provider: input.provider,
        cwd: input.cwd ?? undefined,
        sessionId: input.sessionId ?? undefined
      })
      .then((response) => {
        if (!cancelled) {
          const seen = new Set<string>()
          setSkills(
            response.skills.filter((skill) => {
              if (!skill.enabled || seen.has(skill.name)) {
                return false
              }
              seen.add(skill.name)
              return true
            })
          )
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSkills([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [input.provider, input.cwd, input.sessionId])

  return skills
}
