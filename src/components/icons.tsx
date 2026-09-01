type IconProps = { size?: number; className?: string };

export function ArrowRightIcon({ size = 18, className }: IconProps) {
  return <svg aria-hidden="true" className={className} fill="none" height={size} viewBox="0 0 24 24" width={size}><path d="M5 12h13M14 7l5 5-5 5" stroke="currentColor" strokeLinecap="square" strokeWidth="1.7" /></svg>;
}

export function UploadIcon({ size = 22, className }: IconProps) {
  return <svg aria-hidden="true" className={className} fill="none" height={size} viewBox="0 0 24 24" width={size}><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" stroke="currentColor" strokeLinecap="square" strokeWidth="1.7" /></svg>;
}

export function DownloadIcon({ size = 22, className }: IconProps) {
  return <svg aria-hidden="true" className={className} fill="none" height={size} viewBox="0 0 24 24" width={size}><path d="M12 4v12m0 0l4.5-4.5M12 16l-4.5-4.5M5 19h14" stroke="currentColor" strokeLinecap="square" strokeWidth="1.7" /></svg>;
}

export function FileIcon({ size = 22, className }: IconProps) {
  return <svg aria-hidden="true" className={className} fill="none" height={size} viewBox="0 0 24 24" width={size}><path d="M6 3h8l4 4v14H6V3Z" stroke="currentColor" strokeWidth="1.5" /><path d="M14 3v5h4" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

export function CopyIcon({ size = 18, className }: IconProps) {
  return <svg aria-hidden="true" className={className} fill="none" height={size} viewBox="0 0 24 24" width={size}><path d="M9 8h10v12H9V8Z" stroke="currentColor" strokeWidth="1.6" /><path d="M15 8V4H5v12h4" stroke="currentColor" strokeWidth="1.6" /></svg>;
}

export function CheckIcon({ size = 18, className }: IconProps) {
  return <svg aria-hidden="true" className={className} fill="none" height={size} viewBox="0 0 24 24" width={size}><path d="m5 12 4.5 4.5L19 7" stroke="currentColor" strokeLinecap="square" strokeWidth="1.8" /></svg>;
}

export function CloseIcon({ size = 18, className }: IconProps) {
  return <svg aria-hidden="true" className={className} fill="none" height={size} viewBox="0 0 24 24" width={size}><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.6" /></svg>;
}
