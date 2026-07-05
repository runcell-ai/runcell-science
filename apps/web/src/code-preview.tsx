import type { FileOptions, SupportedLanguages } from '@pierre/diffs/react'
import { File as DiffsFile } from '@pierre/diffs/react'
import { preloadFile } from '@pierre/diffs/ssr'
import { useEffect, useMemo, useState } from 'react'

type CodePreviewProps = {
  fileName: string
  contents: string
  language?: SupportedLanguages
  className?: string
  disableLineNumbers?: boolean
}

function CodePreview({
  fileName,
  contents,
  language,
  className,
  disableLineNumbers = false
}: CodePreviewProps) {
  const [prerenderedHTML, setPrerenderedHTML] = useState<string | null>(null)
  const [preloadFailed, setPreloadFailed] = useState(false)
  const file = useMemo(
    () => ({
      name: fileName,
      contents,
      lang: language
    }),
    [contents, fileName, language]
  )

  const options = useMemo<FileOptions<undefined>>(
    () => ({
      disableFileHeader: true,
      disableLineNumbers,
      overflow: 'scroll',
      themeType: 'system'
    }),
    [disableLineNumbers]
  )

  useEffect(() => {
    let cancelled = false

    setPrerenderedHTML(null)
    setPreloadFailed(false)

    void preloadFile({ file, options })
      .then((result) => {
        if (!cancelled) {
          setPrerenderedHTML(result.prerenderedHTML)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error('Code preview syntax highlighting failed', error)
          setPreloadFailed(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [file, options])

  return (
    <div className={className ? `code-preview ${className}` : 'code-preview'}>
      {prerenderedHTML && !preloadFailed ? (
        <DiffsFile
          file={file}
          options={options}
          className="code-preview-container"
          prerenderedHTML={prerenderedHTML}
          disableWorkerPool
        />
      ) : (
        <pre className="preview-text code-preview-fallback">{contents}</pre>
      )}
    </div>
  )
}

export { CodePreview }
