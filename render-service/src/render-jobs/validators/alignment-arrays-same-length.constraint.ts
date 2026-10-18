import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Exige que `characters`, `character_start_times_seconds` y `character_end_times_seconds` tengan la misma longitud. */
@ValidatorConstraint({ name: 'alignmentArraysSameLength', async: false })
export class AlignmentArraysSameLengthConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const { characters, character_start_times_seconds, character_end_times_seconds } =
      args.object as Record<string, unknown>;
    if (
      !Array.isArray(characters) ||
      !Array.isArray(character_start_times_seconds) ||
      !Array.isArray(character_end_times_seconds)
    ) {
      return false;
    }
    return (
      characters.length === character_start_times_seconds.length &&
      characters.length === character_end_times_seconds.length
    );
  }

  defaultMessage(): string {
    return 'characters, character_start_times_seconds y character_end_times_seconds deben tener la misma longitud';
  }
}
