import { CharacterAlignment, groupCharactersIntoWords } from './group-characters-into-words.js';

/** Construye una alineación donde el carácter i dura de i*0.1 a (i+1)*0.1. */
function alignmentOf(text: string): CharacterAlignment {
  const characters = Array.from(text);
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => round(i * 0.1)),
    character_end_times_seconds: characters.map((_, i) => round((i + 1) * 0.1)),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

describe('groupCharactersIntoWords', () => {
  it('agrupa una frase simple', () => {
    expect(groupCharactersIntoWords(alignmentOf('Hola mundo'))).toEqual([
      { text: 'Hola', start: 0, end: 0.4 },
      { text: 'mundo', start: 0.5, end: 1 },
    ]);
  });

  it('deja la puntuación pegada a la palabra', () => {
    expect(groupCharactersIntoWords(alignmentOf('¡Hola, mundo!'))).toEqual([
      { text: '¡Hola,', start: 0, end: 0.6 },
      { text: 'mundo!', start: 0.7, end: 1.3 },
    ]);
  });

  it('ignora espacios dobles, iniciales y finales sin palabras vacías', () => {
    expect(groupCharactersIntoWords(alignmentOf('  Hola   mundo  '))).toEqual([
      { text: 'Hola', start: 0.2, end: 0.6 },
      { text: 'mundo', start: 0.9, end: 1.4 },
    ]);
  });

  it('conserva tildes y ñ', () => {
    expect(groupCharactersIntoWords(alignmentOf('Año fantástico'))).toEqual([
      { text: 'Año', start: 0, end: 0.3 },
      { text: 'fantástico', start: 0.4, end: 1.4 },
    ]);
  });

  it('acepta un solo carácter', () => {
    expect(
      groupCharactersIntoWords({
        characters: ['Y'],
        character_start_times_seconds: [0.05],
        character_end_times_seconds: [0.2],
      }),
    ).toEqual([{ text: 'Y', start: 0.05, end: 0.2 }]);
  });

  it('corta palabras en un salto de línea', () => {
    expect(groupCharactersIntoWords(alignmentOf('Hola\nmundo\n'))).toEqual([
      { text: 'Hola', start: 0, end: 0.4 },
      { text: 'mundo', start: 0.5, end: 1 },
    ]);
  });

  it('devuelve [] si solo hay espacios', () => {
    expect(groupCharactersIntoWords(alignmentOf('   '))).toEqual([]);
  });

  it('falla si los arrays no tienen la misma longitud', () => {
    expect(() =>
      groupCharactersIntoWords({
        characters: ['a', 'b'],
        character_start_times_seconds: [0],
        character_end_times_seconds: [0.1, 0.2],
      }),
    ).toThrow(RangeError);
  });
});
