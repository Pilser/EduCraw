import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { FileNode } from '../api/types'

export function useStudentFileTree(sessionId: string, token: string) {
  return useQuery({
    queryKey: ['files', 'student', sessionId],
    queryFn: () => api.listStudentFiles(sessionId, token),
    enabled: !!sessionId && !!token,
  })
}

export function useSubjectFileTree(subjectIds: string[], token: string) {
  return useQuery({
    queryKey: ['files', 'subject', subjectIds.join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        subjectIds.map(slug =>
          api.listSubjectFiles(slug, token).then(children => ({
            name: slug,
            path: slug,
            kind: 'dir' as const,
            children,
          } satisfies FileNode))
        )
      )
      return results
    },
    enabled: subjectIds.length > 0 && !!token,
  })
}

export function useUploadStudentFile(sessionId: string, token: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string | ArrayBuffer }) =>
      api.uploadStudentFile(sessionId, path, content, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files', 'student', sessionId] })
    },
  })
}

export function useDeleteStudentFile(sessionId: string, token: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ path }: { path: string }) => {
      const res = await fetch(
        `${apiBase()}/files/student/${sessionId}/delete?path=${encodeURIComponent(path)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      if (!res.ok) throw new Error(`Failed to delete: ${res.statusText}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files', 'student', sessionId] })
    },
  })
}

function apiBase() {
  return ''
}
