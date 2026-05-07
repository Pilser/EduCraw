import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { Paperclip, X, Check, Image as ImageIcon, File as FileIcon, Trash2, CheckCircle2, AlertCircle } from 'lucide-react'

export interface AttachedFile {
  name: string
  file: File
  dataUrl: string  // base64 data-URL (images only)
  mimeType: string
  fileType: 'image' | 'other'  // Separate images from other files
  uploadStatus?: 'pending' | 'uploading' | 'success' | 'error'
  uploadError?: string
}

interface Props {
  onImageSelected?: (file: AttachedFile) => void  // Single image to send with message
  onFilesUploaded?: (files: AttachedFile[]) => void  // Non-image files uploaded to workspace
  onStatusChange?: (status: string) => void
  disabled?: boolean
}

export interface FileInputAttachmentHandle {
  clearAll: () => void
}

const FileInputAttachment = forwardRef<FileInputAttachmentHandle, Props>(
  ({ 
    onImageSelected, 
    onFilesUploaded, 
    onStatusChange,
    disabled = false 
  }, ref) => {
  const [attachedImage, setAttachedImage] = useState<AttachedFile | null>(null)
  const [otherFiles, setOtherFiles] = useState<AttachedFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Expose clearAll method to parent
  useImperativeHandle(ref, () => ({
    clearAll: () => {
      setAttachedImage(null)
      setOtherFiles([])
      onImageSelected?.(null as any)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }), [onImageSelected])

  const isImageFile = (mimeType: string): boolean => {
    return mimeType.startsWith('image/')
  }

  const encodeFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const getFileTypeIcon = (mimeType: string) => {
    if (isImageFile(mimeType)) {
      return <ImageIcon className="w-4 h-4 text-wp-accent" />
    }
    return <FileIcon className="w-4 h-4 text-wp-text-tertiary" />
  }

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'uploading':
        return <div className="w-4 h-4 border-2 border-wp-accent border-t-transparent rounded-full animate-spin" />
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-wp-success" />
      case 'error':
        return <AlertCircle className="w-4 h-4 text-wp-error" />
      default:
        return <Check className="w-4 h-4 text-wp-success" />
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length === 0) return

      const imageFiles: AttachedFile[] = []
      const otherFilesList: AttachedFile[] = []

      for (const file of files) {
        try {
          // Check file size
          if (file.size > MAX_FILE_SIZE) {
            const errorFile: AttachedFile = {
              name: file.name,
              file,
              dataUrl: '',
              mimeType: file.type,
              fileType: 'other',
              uploadStatus: 'error',
              uploadError: 'File exceeds 10MB limit'
            }
            otherFilesList.push(errorFile)
            continue
          }

          // Only encode images to base64; other files are handled separately
          let dataUrl = ''
          if (isImageFile(file.type)) {
            dataUrl = await encodeFileToBase64(file)
          }

          const attachedFile: AttachedFile = {
            name: file.name,
            file,
            dataUrl,
            mimeType: file.type,
            fileType: isImageFile(file.type) ? 'image' : 'other',
            uploadStatus: 'pending',
          }

          if (isImageFile(file.type)) {
            imageFiles.push(attachedFile)
          } else {
            otherFilesList.push(attachedFile)
          }
        } catch (err) {
          console.error(`Failed to process file ${file.name}:`, err)
        }
      }

      // Handle image — only keep the first one for chat message
      if (imageFiles.length > 0) {
        const selectedImage = imageFiles[0]
        setAttachedImage(selectedImage)
        onImageSelected?.(selectedImage)
        onStatusChange?.(`Image selected: ${selectedImage.name}`)
      }

      // Handle other files — mark for upload
      if (otherFilesList.length > 0) {
        setOtherFiles(prev => [...prev, ...otherFilesList])
        onStatusChange?.(`${otherFilesList.length} file(s) ready to upload`)
      }

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [onImageSelected, onFilesUploaded, onStatusChange]
  )

  const handleClearImage = useCallback(() => {
    setAttachedImage(null)
    onImageSelected?.(null as any)
    onStatusChange?.('Image cleared')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [onImageSelected, onStatusChange])

  const handleRemoveOtherFile = useCallback(
    (index: number) => {
      const updatedFiles = otherFiles.filter((_, i) => i !== index)
      setOtherFiles(updatedFiles)
      onStatusChange?.(`Removed file. ${updatedFiles.length} remaining.`)
    },
    [otherFiles, onStatusChange]
  )

  const handleClearAllFiles = useCallback(() => {
    setAttachedImage(null)
    setOtherFiles([])
    onImageSelected?.(null as any)
    onStatusChange?.('All files cleared')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [onImageSelected, onStatusChange])

  const totalFiles = (attachedImage ? 1 : 0) + otherFiles.length

  return (
    <div className="flex flex-col gap-2">
      {/* File input button + Clear all button */}
      <div className="flex gap-2 items-center">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="flex items-center gap-2 px-2 py-2 rounded-wp-md"
            title="Select image or files"
          >
            <Paperclip className="w-4 h-4 text-wp-accent" />
          </button>

        {totalFiles > 0 && (
          <button
            onClick={handleClearAllFiles}
            disabled={disabled}
            className="flex items-center gap-1 px-2 py-1 rounded-wp-md"
            title="Clear all files"
          >
            <X className="w-4 h-4 text-wp-accent" />
          </button>
        )}

        <span className="text-xs text-wp-text-tertiary ml-auto">
          {totalFiles > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-flex items-center gap-1">
                {attachedImage && <span>1 image</span>}
                {otherFiles.length > 0 && (
                  <span>{otherFiles.length} file{otherFiles.length !== 1 ? 's' : ''}</span>
                )}
              </span>
            </span>
          )}
        </span>
      </div>

      {/* Image section */}
      {attachedImage && (
        <div className="border border-wp-border-soft rounded-wp-lg p-3">
          <div className="text-xs font-semibold text-wp-text-secondary mb-2 flex items-center gap-1">
            <ImageIcon className="w-3 h-3 text-wp-accent" />
            Image for chat
          </div>
          <div className="flex items-center gap-2 p-2 rounded-wp-md border border-wp-border-mid hover:border-wp-accent transition-all group">
            <div className="shrink-0">
              <ImageIcon className="w-4 h-4 text-wp-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-wp-text-primary truncate">
                {attachedImage.name}
              </p>
              <p className="text-xs text-wp-text-tertiary">
                {formatFileSize(attachedImage.file.size)} · {attachedImage.mimeType}
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-2">
<Check className="w-4 h-4 text-wp-accent" />
            </div>
            <button
              onClick={handleClearImage}
              disabled={disabled}
              className="shrink-0 p-1 rounded-wp-sm"
              title="Remove image"
            >
              <Trash2 className="w-4 h-4 text-wp-accent" />
            </button>
          </div>
        </div>
      )}

      {/* Other files section */}
      {otherFiles.length > 0 && (
        <div className="border border-wp-border-soft rounded-wp-lg p-3">
          <div className="text-xs font-semibold text-wp-text-secondary mb-2 flex items-center gap-1">
            <FileIcon className="w-3 h-3 text-wp-accent" />
            Files to upload to workspace
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {otherFiles.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
className="flex items-center gap-2 p-2 rounded-wp-md border border-wp-border-mid 
                   hover:border-wp-accent transition-all group"
              >
                <div className="shrink-0">
                  {getFileTypeIcon(file.mimeType)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-wp-text-primary truncate">
                    {file.name}
                  </p>
                  <p className="text-xs text-wp-text-tertiary">
                    {formatFileSize(file.file.size)} · {file.mimeType || 'unknown'}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {getStatusIcon(file.uploadStatus)}
                  {file.uploadStatus === 'error' && file.uploadError && (
                    <span className="text-xs text-wp-error truncate max-w-xs">{file.uploadError}</span>
                  )}
                </div>
                <button
                  onClick={() => handleRemoveOtherFile(index)}
                  disabled={disabled || file.uploadStatus === 'uploading'}
                  className="shrink-0 p-1 rounded-wp-sm"
                  title="Remove file"
                >
                  <Trash2 className="w-4 h-4 text-wp-accent" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInputChange}
        className="hidden"
        accept="image/*,.pdf,.doc,.docx,.txt,.md,.js,.ts,.py,.rs,.json,.yaml,.yml,.cpp,.c,.java,.go"
        disabled={disabled}
      />
    </div>
  )
})

FileInputAttachment.displayName = 'FileInputAttachment'

export default FileInputAttachment
