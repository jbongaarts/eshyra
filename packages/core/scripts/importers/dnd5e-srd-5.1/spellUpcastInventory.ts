/** Independently reviewed source membership. Do not derive this list from the
 * emitter: a changed source clause must produce a reviewed diff here. */
export const EXPECTED_HIGHER_SLOT_SPELL_KEYS = [
  'spell:acid-arrow',
  'spell:aid',
  'spell:animal-friendship',
  'spell:animal-messenger',
  'spell:animate-dead',
  'spell:animate-objects',
  'spell:arcane-hand',
  'spell:bane',
  'spell:banishment',
  'spell:bestow-curse',
  'spell:bless',
  'spell:blight',
  'spell:blindness-deafness',
  'spell:branding-smite',
  'spell:burning-hands',
  'spell:call-lightning',
  'spell:chain-lightning',
  'spell:charm-person',
  'spell:circle-of-death',
  'spell:cloudkill',
  'spell:color-spray',
  'spell:command',
  'spell:cone-of-cold',
  'spell:confusion',
  'spell:conjure-animals',
  'spell:conjure-celestial',
  'spell:conjure-elemental',
  'spell:conjure-fey',
  'spell:conjure-minor-elementals',
  'spell:conjure-woodland-beings',
  'spell:counterspell',
  'spell:create-or-destroy-water',
  'spell:create-undead',
  'spell:creation',
  'spell:cure-wounds',
  'spell:delayed-blast-fireball',
  'spell:disintegrate',
  'spell:dispel-magic',
  'spell:dominate-beast',
  'spell:dominate-monster',
  'spell:dominate-person',
  'spell:enhance-ability',
  'spell:etherealness',
  'spell:false-life',
  'spell:fireball',
  'spell:flame-blade',
  'spell:flame-strike',
  'spell:flaming-sphere',
  'spell:fly',
  'spell:fog-cloud',
  'spell:freezing-sphere',
  'spell:geas',
  'spell:globe-of-invulnerability',
  'spell:glyph-of-warding',
  'spell:guiding-bolt',
  'spell:heal',
  'spell:healing-word',
  'spell:heat-metal',
  'spell:hellish-rebuke',
  'spell:heroism',
  'spell:hold-monster',
  'spell:hold-person',
  'spell:hunters-mark',
  'spell:ice-storm',
  'spell:inflict-wounds',
  'spell:insect-plague',
  'spell:invisibility',
  'spell:lightning-bolt',
  'spell:longstrider',
  'spell:magic-circle',
  'spell:magic-missile',
  'spell:magic-weapon',
  'spell:major-image',
  'spell:mass-cure-wounds',
  'spell:mass-healing-word',
  'spell:mass-suggestion',
  'spell:modify-memory',
  'spell:moonbeam',
  'spell:phantasmal-killer',
  'spell:planar-binding',
  'spell:prayer-of-healing',
  'spell:private-sanctum',
  'spell:scorching-ray',
  'spell:shatter',
  'spell:sleep',
  'spell:spirit-guardians',
  'spell:spiritual-weapon',
  'spell:thunderwave',
  'spell:vampiric-touch',
  'spell:wall-of-fire',
  'spell:wall-of-ice',
  'spell:wall-of-thorns',
] as const;

export const EXPECTED_CHARACTER_LEVEL_SPELL_KEYS = [
  'spell:acid-splash',
  'spell:chill-touch',
  'spell:eldritch-blast',
  'spell:fire-bolt',
  'spell:poison-spray',
  'spell:produce-flame',
  'spell:ray-of-frost',
  'spell:sacred-flame',
  'spell:shocking-grasp',
  'spell:vicious-mockery',
] as const;

/** Independently reviewed hashes of each verbatim retained higher-slot clause. */
export const EXPECTED_HIGHER_SLOT_SOURCE_SHA256: Readonly<
  Record<string, string>
> = {
  'spell:acid-arrow':
    '2c2e4043c361bb68525b03aefd910d9528a8282cfb50576020997dd6a9835308',
  'spell:aid':
    '8f0790863f35c2ee362174f5cfd58d75116d2076b18d7ee392ba5e2247dadfa7',
  'spell:animal-friendship':
    '763c0d3cc1b446babf436fdeca9697a320923ca890a580df1c5d0095c5e32dde',
  'spell:animal-messenger':
    'a1675168e79ba6e95bbcd0e688c0e8a6921e902bd17a6aaf79e4f8ebbc43cd84',
  'spell:animate-dead':
    '127457a0f418892ab170453feb41e70da6809e1b654f51e50083c08fdda78c9b',
  'spell:animate-objects':
    'a03d47f6eaa84023f4ec88126abf6127c55c1b606162828728c2793ada610d03',
  'spell:arcane-hand':
    'fc6cd40a1879a51d27fbf6491d4c867c6dc1b8ba4a9013c840bee52ddce1a96c',
  'spell:bane':
    'f4c84a20aa8e6fc71da0058ac97e9f86b929f428be1a19674ba646a31b9c0447',
  'spell:banishment':
    '4e94dbfb1e55c14308cbd2eb516e7c693f7a0156b3916f74e506da4b48aa7535',
  'spell:bestow-curse':
    '29c5379ee1fbdee31d7c154e0a0a5f1f1cc27c48a545a8680e956f3f42a2def0',
  'spell:bless':
    'f4c84a20aa8e6fc71da0058ac97e9f86b929f428be1a19674ba646a31b9c0447',
  'spell:blight':
    'f336a2849ecfb8b3bb89c51e415291a364a208c0651a2fb059713be48157018b',
  'spell:blindness-deafness':
    '9863dd656e710864bc3128b4fd16f4c9d992fee962cd5876803ef4b63626d7d6',
  'spell:branding-smite':
    '3d0d7f5285b2fc0cf090598211ad0bb8d8a40a66afbae2593489cedcaf8c5bc6',
  'spell:burning-hands':
    'df3f0cf4ef297ad0f11e8b88081ebe872ce88f77340e4b40df90cfb9e6a934df',
  'spell:call-lightning':
    '729f94cc7a4e32866ca500cd919ad1f3cb58b3b45a0658beb163e9816dc42816',
  'spell:chain-lightning':
    'b749d90684ad8660bfa55e54686e1efc8724405d135b87669598216670459176',
  'spell:charm-person':
    '4842c251509bcddb74f835083079c86570146e770c4ae89a216bad557bad1d3c',
  'spell:circle-of-death':
    '05d66562ad3c7f27022aa574f1f18b1e04ae25c2f6f20b685e46c172f4105905',
  'spell:cloudkill':
    '6440dd109137cb53aa56a86d98b0bfb85cc8e7809e51517c64995a772336f0a5',
  'spell:color-spray':
    'a5048cec1120c30afd20256dccae7e5fe6c4510c67b2bd2b9e3d2cb84153f2fe',
  'spell:command':
    'f87da7c07d73e0285736f8b987a438481a1d578efcefaffff4514c8cbcb2d5ca',
  'spell:cone-of-cold':
    '6440dd109137cb53aa56a86d98b0bfb85cc8e7809e51517c64995a772336f0a5',
  'spell:confusion':
    '69fb8cd8b6046abced22459437b8016dc9340762d67f25334674a423d0f9a9eb',
  'spell:conjure-animals':
    'ecbc02dbac96a51447693878a2bdbbbfd918eed442cc756c1fdcf6bc191f18d6',
  'spell:conjure-celestial':
    'd4b124d90ea5372e289317238b90fdc47eeca223e1fa8603b9d8a5cf0e0c4d0c',
  'spell:conjure-elemental':
    '7ed139fdacd17c5478a750187dee4fd8f349389f57af64c33edb127a67cb25fc',
  'spell:conjure-fey':
    'c062bcf581446ac372d333340105675f3b6c1365312d00e09af60f09bd9df0b1',
  'spell:conjure-minor-elementals':
    'd51d3f80638c3a1027aca2b6379e6944232aa2943d7542522098ba5ea1dd6416',
  'spell:conjure-woodland-beings':
    'd51d3f80638c3a1027aca2b6379e6944232aa2943d7542522098ba5ea1dd6416',
  'spell:counterspell':
    '12f6e575b3da5e768f97899fc4173fa8c6498e42c85ee0e0a240ac20da39860a',
  'spell:create-or-destroy-water':
    'b5bcf52655bafdbfc91ed84947a567182cee8150f1a484cd65fa15c1e9f43fe5',
  'spell:create-undead':
    'fb15d7e132a4e38fee8c21879cb665241ebe55a8bab040831b917634c8d21b8f',
  'spell:creation':
    '38f533693e4b635f54f7da539ae36c4f9431cc459587ca49c9b52b3cbaaa0218',
  'spell:cure-wounds':
    '5e0db88dc6045687db6da565c019b0a99274e944f890bbddd175387d284065f9',
  'spell:delayed-blast-fireball':
    'f40180c0612ec446067d14b32c5ec272ac7ddce8caaf66707fab8330b80af61a',
  'spell:disintegrate':
    'a786511c56fac1eb40797a1016efe11a4b79c64c2a4a893286a9ad27cd245f79',
  'spell:dispel-magic':
    '7661796ba3d359a747bb01f5a7ed77d6e3f5912e35658facb9169268a3ab9e16',
  'spell:dominate-beast':
    'ebf00b187508b72a52e464844a40010eb5fb16a73dbbf216365d8ae4e53ec5cc',
  'spell:dominate-monster':
    'bd3a2f59faae7435410e0f9a9e7b93436a779cb7d045c14cefcf4aa44f80e9ef',
  'spell:dominate-person':
    '3db9beb951231b1b18fc7dbb1e2dbb8bd3178e06bdeaa09dacf9314c217a6244',
  'spell:enhance-ability':
    '9863dd656e710864bc3128b4fd16f4c9d992fee962cd5876803ef4b63626d7d6',
  'spell:etherealness':
    '5bd2b9b41773abee6fe52b37c45e90309f47f6afbed66d53c952afeb88f34c14',
  'spell:false-life':
    '8f9bb76fb76b784002df39b2ea72d38f39edf28f8e3f7a00642b2eeada97b13d',
  'spell:fireball':
    'a1f3bd75f5c3e148b5648a12466591c9d4de30b098ff745efca885e1c8dc96b7',
  'spell:flame-blade':
    '51c181a6294c0bda43e2b3e84d9d24055f0083c3ed2a1af46fa48a3edc2f4a18',
  'spell:flame-strike':
    'cd94b495d6be348f675aa601af72181865334bf7cad68ba7fe31dbed5406d2aa',
  'spell:flaming-sphere':
    '5d2c32f2fff7978f41a21246a7ceb4692dfc935f693f91bd3f3b0a55da3ad239',
  'spell:fly':
    '577fc54752ef1b3973bda655e932e42def258c23d6e4a60020bb006917b17eb2',
  'spell:fog-cloud':
    '9cb3dd1ab124c4be64e45625ad37321de81b922a353da2890a47b601f2f1c8aa',
  'spell:freezing-sphere':
    'e81acf8253d72c6045cf203be57574e56f81f701c241aa984cf88ee645e6824c',
  'spell:geas':
    '51e313df9d94919d865bdcde6a453ec6db65da5d2896f2a054b60e7e1982fe5f',
  'spell:globe-of-invulnerability':
    '78fe51756bf408b9072bcddd598180a5e55adc4497ab92453af18b7782e423c3',
  'spell:glyph-of-warding':
    '73aa890daf72fd3529f3ba89e7132fe5cf70cdcdff1ababd210c1ea6d6102252',
  'spell:guiding-bolt':
    'df3f0cf4ef297ad0f11e8b88081ebe872ce88f77340e4b40df90cfb9e6a934df',
  'spell:heal':
    'b18f084c3e03a9e1e79d7b1a66afa6b994ae5262ebcfc70d41e83da0c46b4303',
  'spell:healing-word':
    '731c348c230684009da02dc49a2b79e22f8b5414c98f35de3d2c4a5ff2782e3a',
  'spell:heat-metal':
    '2e149a6aa5170715c5dddf2bb6ffb9085b7d9a466f8023c16b874f2b611daba8',
  'spell:hellish-rebuke':
    '1b86a6cb9740c6fc1ac0b8f735c404cdf9295b318991a2e3576080ff13908a7a',
  'spell:heroism':
    'f4c84a20aa8e6fc71da0058ac97e9f86b929f428be1a19674ba646a31b9c0447',
  'spell:hold-monster':
    '22140dbffdca41f35146b10162cf53fb0b7b0229d8a45fa6ca8716c8f81ed698',
  'spell:hold-person':
    '4a945b9ff4ea58f18d85cd6088e84c2fe612dc21071ff18480cc414893557a7a',
  'spell:hunters-mark':
    '4929eee8d3fe81d0764f46b55fded276b6cda3e4796df503c1041265343b8595',
  'spell:ice-storm':
    'dce94da563fb997796d86b7a4e79b7b9eb1090786244d5e19b317c26867c7d5c',
  'spell:inflict-wounds':
    '1b86a6cb9740c6fc1ac0b8f735c404cdf9295b318991a2e3576080ff13908a7a',
  'spell:insect-plague':
    '80f8c418674c22746d75603fe5a943b52d8266032bbe380a0b4ecbdee5129524',
  'spell:invisibility':
    '9863dd656e710864bc3128b4fd16f4c9d992fee962cd5876803ef4b63626d7d6',
  'spell:lightning-bolt':
    'a1f3bd75f5c3e148b5648a12466591c9d4de30b098ff745efca885e1c8dc96b7',
  'spell:longstrider':
    'f4c84a20aa8e6fc71da0058ac97e9f86b929f428be1a19674ba646a31b9c0447',
  'spell:magic-circle':
    'f961e824325e839b66761fa3040440be13a01bcecf3d2510c6c28c4180d05f86',
  'spell:magic-missile':
    'b75d235ff41dba95848854426d790f3ae2ca88a378c5492da1bf582a97289f1a',
  'spell:magic-weapon':
    '1f38dcccd1e0aee32ee56fe6d2d0d24dd14be838dd3bf688117e581c8eb32b7e',
  'spell:major-image':
    '300af56fa980091d64c0655f3fdfc5eb5b5e5ac1686cc7cf214829ccfcb96f16',
  'spell:mass-cure-wounds':
    '87cd6ab1dc72fce32bf20fb866ecb5e6bef647ebfb73d8e0bf524a3ac8e6dba8',
  'spell:mass-healing-word':
    '5c13dad44005c0f03dd3ff497f304bdce005436d4fd8607a330d318af12cfdfe',
  'spell:mass-suggestion':
    'ed9c54a64ad0163233d91a797a1a48bb0422d5f6bb895ece31db664016758183',
  'spell:modify-memory':
    '0eb5cf9628669a8b754788235e942acdb9ef5faad1ee44d1977ee4291fe8e933',
  'spell:moonbeam':
    'a8d7223af1f3cf32785038dd8864dc7d50109412e32d20b6ade36c230ccbbfd3',
  'spell:phantasmal-killer':
    '752cfebcfed3b66ead18f094a070734fd9cd1a1979c167160813933ba57370fb',
  'spell:planar-binding':
    'fea6b4379a0644dcc9cca5899319c66941f7c6387a5bb7116aa4a9d37a818e9f',
  'spell:prayer-of-healing':
    'e1fdf68bea8690a035fb22d5d4844e907650266c614baab91cc7dfc7065a0986',
  'spell:private-sanctum':
    'acc3b75bc83b15080bb2a6a1c81c6ded4039079a00b691a9dfd4fb9101652ab9',
  'spell:scorching-ray':
    'd1015e8b497a87b42ec4205fffc047df591659544f7d3eb62a31be169232966f',
  'spell:shatter':
    '2e149a6aa5170715c5dddf2bb6ffb9085b7d9a466f8023c16b874f2b611daba8',
  'spell:sleep':
    '023f11bc841edab19919144a9697afb7d4da77915ef83edb7b5461057ceca137',
  'spell:spirit-guardians':
    '2efc62144e96815f1a97972ec179a1b84007a01810a474101209f85b2228e9ae',
  'spell:spiritual-weapon':
    '35ebc94abebe4082eb7edc93fb0786e523021dcd66948a607343adecac88fadb',
  'spell:thunderwave':
    '8cc31ac0fdfa098f3a2f922ee9d40fd2ef498d019318519d870b632b47fbed47',
  'spell:vampiric-touch':
    'a1f3bd75f5c3e148b5648a12466591c9d4de30b098ff745efca885e1c8dc96b7',
  'spell:wall-of-fire':
    'f336a2849ecfb8b3bb89c51e415291a364a208c0651a2fb059713be48157018b',
  'spell:wall-of-ice':
    '4bec84f7934d9e3d995d718c26779e2b8db4a721c4e10d70869f71b6560086da',
  'spell:wall-of-thorns':
    'e325f942ab269229dc491b1dfa3dd82c736803b3fd08fe1f1ed7ad2973e5de27',
};

export const EXPECTED_HIGHER_SLOT_SOURCE_PAGES: Readonly<
  Record<string, number>
> = {
  'spell:acid-arrow': 114,
  'spell:aid': 114,
  'spell:animal-friendship': 115,
  'spell:animal-messenger': 115,
  'spell:animate-dead': 115,
  'spell:animate-objects': 116,
  'spell:arcane-hand': 118,
  'spell:bane': 120,
  'spell:banishment': 120,
  'spell:bestow-curse': 121,
  'spell:bless': 122,
  'spell:blight': 122,
  'spell:blindness-deafness': 122,
  'spell:branding-smite': 123,
  'spell:burning-hands': 123,
  'spell:call-lightning': 123,
  'spell:chain-lightning': 124,
  'spell:charm-person': 124,
  'spell:circle-of-death': 124,
  'spell:cloudkill': 125,
  'spell:color-spray': 125,
  'spell:command': 125,
  'spell:cone-of-cold': 127,
  'spell:confusion': 127,
  'spell:conjure-animals': 127,
  'spell:conjure-celestial': 127,
  'spell:conjure-elemental': 128,
  'spell:conjure-fey': 128,
  'spell:conjure-minor-elementals': 128,
  'spell:conjure-woodland-beings': 129,
  'spell:counterspell': 131,
  'spell:create-or-destroy-water': 132,
  'spell:create-undead': 132,
  'spell:creation': 132,
  'spell:cure-wounds': 132,
  'spell:delayed-blast-fireball': 133,
  'spell:disintegrate': 135,
  'spell:dispel-magic': 136,
  'spell:dominate-beast': 137,
  'spell:dominate-monster': 137,
  'spell:dominate-person': 138,
  'spell:enhance-ability': 139,
  'spell:etherealness': 140,
  'spell:false-life': 142,
  'spell:fireball': 144,
  'spell:flame-blade': 145,
  'spell:flame-strike': 145,
  'spell:flaming-sphere': 145,
  'spell:fly': 146,
  'spell:fog-cloud': 146,
  'spell:freezing-sphere': 147,
  'spell:geas': 148,
  'spell:globe-of-invulnerability': 149,
  'spell:glyph-of-warding': 149,
  'spell:guiding-bolt': 151,
  'spell:heal': 153,
  'spell:healing-word': 153,
  'spell:heat-metal': 153,
  'spell:hellish-rebuke': 154,
  'spell:heroism': 154,
  'spell:hold-monster': 154,
  'spell:hold-person': 154,
  'spell:hunters-mark': 155,
  'spell:ice-storm': 155,
  'spell:inflict-wounds': 157,
  'spell:insect-plague': 157,
  'spell:invisibility': 157,
  'spell:lightning-bolt': 159,
  'spell:longstrider': 160,
  'spell:magic-circle': 160,
  'spell:magic-missile': 161,
  'spell:magic-weapon': 161,
  'spell:major-image': 162,
  'spell:mass-cure-wounds': 162,
  'spell:mass-healing-word': 163,
  'spell:mass-suggestion': 163,
  'spell:modify-memory': 166,
  'spell:moonbeam': 166,
  'spell:phantasmal-killer': 167,
  'spell:planar-binding': 168,
  'spell:prayer-of-healing': 170,
  'spell:private-sanctum': 171,
  'spell:scorching-ray': 176,
  'spell:shatter': 178,
  'spell:sleep': 180,
  'spell:spirit-guardians': 182,
  'spell:spiritual-weapon': 182,
  'spell:thunderwave': 187,
  'spell:vampiric-touch': 189,
  'spell:wall-of-fire': 190,
  'spell:wall-of-ice': 190,
  'spell:wall-of-thorns': 191,
};
