import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Guion generado por el modelo de OpenRouter. */
export class ScriptDto {
  /** Frase gancho que se muestra al inicio del video. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  hook!: string;

  /** Texto completo que se narra (el mismo que se envió a ElevenLabs). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  voiceover!: string;
}
