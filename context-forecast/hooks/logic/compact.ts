const MAX_FILES = 15

export const buildInstructions = (touched: readonly string[]): string => {
  const files = touched.slice(-MAX_FILES)

  return [
    'Compacte preservando, sem encurtar demais:',
    '- o plano em curso e o próximo passo concreto;',
    '- o card ou issue em que se trabalha (número e título);',
    '- a branch atual;',
    files.length === 0
      ? '- os ficheiros tocados nesta sessão;'
      : `- os ficheiros tocados nesta sessão: ${files.join(', ')};`,
    '- as decisões tomadas e o motivo, e o estado dos testes (o que passou e o que falhou);',
    'Se houver STATE.md ou spec ativa, mantenha o caminho e o último checkpoint.'
  ].join('\n')
}

export const vetoText = (reason: string): string => {
  const hint = /STATE\.md/i.test(reason) ? ' Atualize o STATE.md e tente de novo.' : ''

  return `compactação vetada: ${reason}${hint}`
}

export const errorText = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  const hint = /turn/i.test(message) ? ' (só dá para compactar entre turnos)' : ''

  return `não foi possível compactar: ${message}${hint}`
}
