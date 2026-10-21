using System;

namespace KeePassFerry.Models
{
    public class GuidService : IGuidService
    {
        public Guid NewGuid()
        {
            return Guid.NewGuid();
        }
    }
}