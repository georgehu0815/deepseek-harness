/** CSS module imports expose generated class names. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
