import type { CharacterAlignmentDto } from '../dto/character-alignment.dto.js';

/** Formato del JSON `words` que consume la plantilla Hyperframes (`[{text,start,end}]`). */
export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

export type CharacterAlignment = Pick<
  CharacterAlignmentDto,
  'characters' | 'character_start_times_seconds' | 'character_end_times_seconds'
>;

const WORD_SEPARATOR = /\s/;

/**
 * Agrupa la alineación por carácter de ElevenLabs en palabras.
 * Una palabra termina en un espacio o salto de línea; la puntuación queda pegada.
 * `start` = inicio del primer carácter; `end` = fin del último.
 */
export function groupCharactersIntoWords(alignment: CharacterAlignment): WordTiming[] {
  const {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  } = alignment;

  if (starts.length !== characters.length || ends.length !== characters.length) {
    throw new RangeError('characters y los arrays de tiempos deben tener la misma longitud');
  }

  const words: WordTiming[] = [];
  let current: WordTiming | null = null;

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];
    if (WORD_SEPARATOR.test(char)) {
      if (current) words.push(current);
      current = null;
    } else if (current) {
      current.text += char;
      current.end = ends[i];
    } else {
      current = { text: char, start: starts[i], end: ends[i] };
    }
  }

  if (current) words.push(current);
  return words;
}
