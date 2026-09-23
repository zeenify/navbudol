import { Character } from '../models';

/**
 * NavBudol roster. Portraits live in assets/characters/ (copied from
 * Cognify). The anime voice IDs are REAL Fish Audio reference_ids
 * lifted from Cognify's CharacterVoiceClient.kt — they work today.
 *
 * NavBuddy's voice is intentionally empty for now — he speaks with the
 * system TTS fallback until we pin a Fish voice to him.
 */
export const CHARACTERS: Character[] = [
  {
    id: 'buddy',
    name: 'NavBuddy',
    fullName: 'NavBuddy',
    series: '',
    avatar: 'assets/characters/buddy.svg',
    fishVoiceId: '', // left empty for now — NavBuddy uses system TTS fallback
    gainDb: 0,
    tagline: 'Chill co-pilot — our own character',
    greeting: "Yo! I'm NavBuddy. Where are we going today?",
    isDefault: true,
  },
  {
    id: 'gojo',
    name: 'Gojo',
    fullName: 'Gojo Satoru',
    series: 'Jujutsu Kaisen',
    avatar: 'assets/characters/gojo.jpg',
    fishVoiceId: 'c85fb11f91f84312a4bd16756f298ae2', // 601 likes on fish.audio
    gainDb: 0,
    tagline: 'Confident, playful, teasing',
    greeting: 'Yo~ The strongest navigator has arrived. Where to?',
  },
  {
    id: 'makima',
    name: 'Makima',
    fullName: 'Makima',
    series: 'Chainsaw Man',
    avatar: 'assets/characters/makima.jpg',
    fishVoiceId: '0c03219a981c4570a1b23a15b4107f30',
    gainDb: 16, // her raw output is quiet — boost on playback (from Cognify)
    tagline: 'Calm, composed, commanding',
    greeting: 'Good. You have a destination. Tell me what it is.',
  },
  {
    id: 'marin',
    name: 'Marin',
    fullName: 'Marin Kitagawa',
    series: 'My Dress-Up Darling',
    avatar: 'assets/characters/marin.jpg',
    fishVoiceId: '72c3988b410f43c9b0905521135ff010',
    gainDb: 0,
    tagline: 'Energetic, bubbly, total hype',
    greeting: "Hiii! Okay okay, where are we going today?! I'm so excited!",
  },
  {
    id: 'toji',
    name: 'Toji',
    fullName: 'Toji Fushiguro',
    series: 'Jujutsu Kaisen',
    avatar: 'assets/characters/toji.jpg',
    fishVoiceId: 'b1d5b2071ce3450b8f497cca90b78061',
    gainDb: 0,
    tagline: 'Dry, blunt, zero-effort energy',
    greeting: 'Where to. Make it quick.',
  },
  {
    id: 'miku',
    name: 'Miku',
    fullName: 'Miku Nakano',
    series: 'The Quintessential Quintuplets',
    avatar: 'assets/characters/miku_nakano.jpg',
    fishVoiceId: 'ba9fccd271b24b6aaf7eb58e1f1c858a',
    gainDb: 0,
    tagline: 'Warm, gentle, a little shy',
    greeting: "Um... where do you want to go? I'll look it up for you!",
  },
  {
    id: 'reze',
    name: 'Reze',
    fullName: 'Reze',
    series: 'Chainsaw Man',
    avatar: 'assets/characters/reze.jpg',
    fishVoiceId: '7e9fe06681074145b0227d3685b3b570',
    gainDb: 0,
    tagline: 'Soft-spoken, sweet, a little wistful',
    greeting: "Anywhere you want to go... I'll walk with you.",
  },
];
