import { ArrayNotEmpty, IsArray, IsNumber, IsString, Min, Validate } from 'class-validator';
import { AlignmentArraysSameLengthConstraint } from '../validators/alignment-arrays-same-length.constraint.js';

/**
 * Alineación por carácter tal como la devuelve ElevenLabs en
 * `POST /v1/text-to-speech/{voice_id}/with-timestamps` (campo `alignment`).
 * La agrupación en palabras se hace en NestJS, no en n8n.
 */
export class CharacterAlignmentDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Validate(AlignmentArraysSameLengthConstraint)
  characters!: string[];

  @IsArray()
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  character_start_times_seconds!: number[];

  @IsArray()
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  character_end_times_seconds!: number[];
}
