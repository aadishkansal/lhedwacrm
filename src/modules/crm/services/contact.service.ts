import { ContactRepository } from '../repositories/contact.repository';

export class ContactService {
  constructor(private readonly contactRepo = new ContactRepository()) {}

  async fetchAll() {
    return this.contactRepo.getContacts();
  }
}
