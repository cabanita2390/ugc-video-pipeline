import { Type } from 'class-transformer';
import {
  IsBase64,
  IsHexColor,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { CharacterAlignmentDto } from './character-alignment.dto.js';
import { ScriptDto } from './script.dto.js';

/**
 * Payload que n8n envía a `POST /render-jobs`.
 * Nombres en snake_case: reflejan el contrato n8n <-> NestJS y los campos de ElevenLabs.
 */
export class CreateRenderJobDto {
  /**
   * AUDITORÍA: id exacto del modelo de OpenRouter que generó el guion
   * (p. ej. "meta-llama/llama-3.3-70b-instruct:free"). Obligatorio en todo payload.
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9][\w.-]*\/[\w.-]+(:[\w.-]+)?$/i, {
    message: 'ai_model_used debe tener el formato "proveedor/modelo[:variante]"',
  })
  ai_model_used!: string;

  @ValidateNested()
  @Type(() => ScriptDto)
  script!: ScriptDto;

  /** MP3 de ElevenLabs en base64 (campo `audio_base64` de la respuesta with-timestamps). */
  @IsBase64()
  @IsNotEmpty()
  audio_base64!: string;

  @ValidateNested()
  @Type(() => CharacterAlignmentDto)
  alignment!: CharacterAlignmentDto;

  /** Color de acento de los subtítulos. Opcional; la plantilla tiene un valor por defecto. */
  @IsOptional()
  @IsHexColor()
  accent?: string;
}
