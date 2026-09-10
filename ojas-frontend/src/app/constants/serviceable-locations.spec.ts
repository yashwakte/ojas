import { isValidPunePincode, pincodeError } from './serviceable-locations';

describe('pincodeError', () => {
  it('says nothing about an empty field', () => {
    expect(pincodeError('')).toBeNull();
    expect(pincodeError('   ')).toBeNull();
  });

  it('stays quiet while a valid pincode is still being typed', () => {
    // The whole point of the helper is to explain a refusal, not to argue with someone mid-word.
    expect(pincodeError('4')).toBeNull();
    expect(pincodeError('41100')).toBeNull();
  });

  it('accepts a Pune pincode', () => {
    expect(pincodeError('411001')).toBeNull();
    expect(pincodeError('411062')).toBeNull();
    expect(pincodeError(' 411014 ')).toBeNull();
  });

  it('names Pune and the range when the pincode is somewhere else', () => {
    const message = pincodeError('400001');
    expect(message).toContain('Pune');
    expect(message).toContain('411001');
    expect(message).toContain('411062');
  });

  it('rejects the pincodes just outside the range', () => {
    expect(pincodeError('411000')).not.toBeNull();
    expect(pincodeError('411063')).not.toBeNull();
  });

  it('complains about non-digits immediately rather than waiting for six characters', () => {
    expect(pincodeError('41a')).toContain('numbers only');
  });

  it('agrees with isValidPunePincode on every six-digit input it is given', () => {
    for (const value of ['411001', '411062', '410999', '411063', '400001', '560001']) {
      expect(pincodeError(value) === null).toBe(isValidPunePincode(value));
    }
  });
});
